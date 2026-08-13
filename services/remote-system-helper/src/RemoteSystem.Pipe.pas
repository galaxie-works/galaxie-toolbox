unit RemoteSystem.Pipe;

interface

uses
  System.Classes,
  RemoteSystem.Session,
  Winapi.Windows;

type
  TPipeServerThread = class(TThread)
  private
    FAgent: TAgentState;
    FInstallDirectory: string;
    FCurrentPipe: THandle;
    procedure ServeClient(Pipe: THandle);
  protected
    procedure Execute; override;
  public
    constructor Create(Agent: TAgentState; const InstallDirectory: string);
    procedure RequestStop;
  end;

implementation

uses
  System.Generics.Collections,
  System.JSON,
  System.SysUtils,
  RemoteSystem.Protocol,
  RemoteSystem.Security;

const
  PIPE_REJECT_REMOTE_CLIENTS = $00000008;

function ReadPipeMessage(Pipe: THandle; out Data: TBytes): Boolean;
var
  Buffer: array[0..REMOTE_MAX_MESSAGE_BYTES] of Byte;
  BytesRead: Cardinal;
begin
  SetLength(Data, 0);
  BytesRead := 0;
  Result := ReadFile(Pipe, Buffer[0], SizeOf(Buffer), BytesRead, nil);
  if not Result then
    Exit;
  if (BytesRead = 0) or (BytesRead > REMOTE_MAX_MESSAGE_BYTES) then
    Exit(False);
  SetLength(Data, BytesRead);
  Move(Buffer[0], Data[0], BytesRead);
end;

function WritePipeMessage(Pipe: THandle; const Data: TBytes): Boolean;
var
  BytesWritten: Cardinal;
begin
  if (Length(Data) = 0) or (Length(Data) > REMOTE_MAX_MESSAGE_BYTES) then
    Exit(False);
  BytesWritten := 0;
  Result := WriteFile(Pipe, Data[0], Length(Data), BytesWritten, nil) and
    (BytesWritten = Cardinal(Length(Data)));
  if Result then
    FlushFileBuffers(Pipe);
end;

function RequiredCardinal(Payload: TJSONObject; const Name: string;
  out Value: Cardinal): Boolean;
var
  SignedValue: Int64;
begin
  Result := Payload.TryGetValue<Int64>(Name, SignedValue) and
    (SignedValue >= 0) and (SignedValue <= High(Cardinal));
  if Result then
    Value := Cardinal(SignedValue);
end;

function HelloResult(const Nonce: string; ActiveSession: Cardinal): TJSONObject;
var
  Capabilities: TJSONArray;
begin
  Capabilities := TJSONArray.Create;
  Capabilities.Add('service.status');
  Capabilities.Add('agent.ensure');
  Capabilities.Add('agent.stop');
  Capabilities.Add('desktop.setMode');
  Result := TJSONObject.Create;
  Result.AddPair('kind', 'helloAck');
  Result.AddPair('nonce', Nonce);
  Result.AddPair('serviceVersion', '0.1.0');
  Result.AddPair('protocol', TJSONNumber.Create(REMOTE_PROTOCOL_VERSION));
  Result.AddPair('capabilities', Capabilities);
  if ActiveSession <> Cardinal($FFFFFFFF) then
    Result.AddPair('activeSessionId', TJSONNumber.Create(ActiveSession))
  else
    Result.AddPair('activeSessionId', TJSONNull.Create);
end;

constructor TPipeServerThread.Create(Agent: TAgentState;
  const InstallDirectory: string);
begin
  inherited Create(True);
  FreeOnTerminate := False;
  FAgent := Agent;
  FInstallDirectory := InstallDirectory;
  FCurrentPipe := INVALID_HANDLE_VALUE;
end;

procedure TPipeServerThread.RequestStop;
begin
  Terminate;
  if Handle <> 0 then
    CancelSynchronousIo(Handle);
end;

procedure TPipeServerThread.ServeClient(Pipe: THandle);
var
  Handshaken: Boolean;
  Raw, Response, EventData: TBytes;
  Envelope: TRemoteEnvelope;
  ErrorCode, ErrorText, Nonce, ModeText: string;
  ClaimedPid, ClaimedSession, SessionId: Cardinal;
  HasSession: Boolean;
  Mode: TDesktopMode;
  Cache: TDictionary<string, TBytes>;
  StatePayload: TJSONObject;
  LastActiveSession, CurrentActiveSession: Cardinal;
  EventName: string;
begin
  Handshaken := False;
  LastActiveSession := Cardinal($FFFFFFFF);
  Cache := TDictionary<string, TBytes>.Create;
  try
    while not Terminated and ReadPipeMessage(Pipe, Raw) do
    begin
      try
        if not ParseRequest(Raw, Envelope, ErrorCode, ErrorText) then
        begin
          WritePipeMessage(Pipe, BuildError('', ErrorCode, ErrorText, False));
          Break;
        end;
      except
        on E: Exception do
        begin
          WritePipeMessage(Pipe, BuildError('', 'invalid_request',
            'Malformed request', False));
          Break;
        end;
      end;
      try
        if Cache.TryGetValue(Envelope.Id, Response) then
        begin
          if not WritePipeMessage(Pipe, Response) then
            Break;
          Continue;
        end;

        if not Handshaken then
        begin
          if Envelope.Method <> 'hello' then
          begin
            WritePipeMessage(Pipe, BuildError(Envelope.Id, 'handshake_required',
              'hello must be the first request', False));
            Break;
          end;
          if not RequiredCardinal(Envelope.Payload, 'clientPid', ClaimedPid) or
             not RequiredCardinal(Envelope.Payload, 'sessionId', ClaimedSession) or
             not Envelope.Payload.TryGetValue<string>('nonce', Nonce) or
             (Nonce = '') or (Length(Nonce) > 128) then
          begin
            WritePipeMessage(Pipe, BuildError(Envelope.Id, 'invalid_hello',
              'hello requires clientPid, sessionId and nonce', False));
            Break;
          end;
          if not ValidatePipeClient(Pipe, ClaimedPid, ClaimedSession,
            FInstallDirectory, ErrorText) then
          begin
            WritePipeMessage(Pipe, BuildError(Envelope.Id, 'client_rejected',
              ErrorText, False));
            Break;
          end;
          Response := BuildResult(Envelope.Id,
            HelloResult(Nonce, FAgent.ResolveActiveSession));
          LastActiveSession := FAgent.ResolveActiveSession;
          Handshaken := True;
        end
        else if Envelope.Method = 'hello' then
          Response := BuildError(Envelope.Id, 'already_handshaken',
            'hello is accepted only once', False)
        else if not IsAllowedMethod(Envelope.Method) then
          Response := BuildError(Envelope.Id, 'method_not_allowed',
            'Method is not in the v1 allowlist', False)
        else if Envelope.Method = 'service.status' then
          Response := BuildResult(Envelope.Id, FAgent.Snapshot)
        else if Envelope.Method = 'agent.ensure' then
        begin
          HasSession := RequiredCardinal(Envelope.Payload, 'sessionId', SessionId);
          if FAgent.EnsureAgent(SessionId, HasSession, ErrorText) then
            Response := BuildResult(Envelope.Id, FAgent.Snapshot)
          else
            Response := BuildError(Envelope.Id, 'agent_start_failed', ErrorText, True);
        end
        else if Envelope.Method = 'agent.stop' then
        begin
          if not RequiredCardinal(Envelope.Payload, 'sessionId', SessionId) then
            Response := BuildError(Envelope.Id, 'invalid_payload',
              'sessionId is required', False)
          else if FAgent.StopAgent(SessionId, ErrorText) then
            Response := BuildResult(Envelope.Id, FAgent.Snapshot)
          else
            Response := BuildError(Envelope.Id, 'agent_stop_failed', ErrorText, True);
        end
        else
        begin
          if not RequiredCardinal(Envelope.Payload, 'sessionId', SessionId) or
             not Envelope.Payload.TryGetValue<string>('mode', ModeText) or
             not DesktopModeFromString(ModeText, Mode) then
            Response := BuildError(Envelope.Id, 'invalid_payload',
              'desktop.setMode requires sessionId and auto|default|winlogon', False)
          else if FAgent.SetDesktopMode(SessionId, Mode, ErrorText) then
            Response := BuildResult(Envelope.Id, FAgent.Snapshot)
          else
            Response := BuildError(Envelope.Id, 'desktop_switch_failed', ErrorText, True);
        end;

        if Cache.Count >= 128 then
          Cache.Clear;
        Cache.AddOrSetValue(Envelope.Id, Copy(Response));
        if not WritePipeMessage(Pipe, Response) then
          Break;

        CurrentActiveSession := FAgent.ResolveActiveSession;
        if Handshaken and (CurrentActiveSession <> LastActiveSession) then
        begin
          StatePayload := TJSONObject.Create;
          if CurrentActiveSession <> Cardinal($FFFFFFFF) then
            StatePayload.AddPair('sessionId', TJSONNumber.Create(CurrentActiveSession))
          else
            StatePayload.AddPair('sessionId', TJSONNull.Create);
          EventData := BuildEvent('session.changed', StatePayload);
          if not WritePipeMessage(Pipe, EventData) then
            Break;
          LastActiveSession := CurrentActiveSession;
        end;

        if Handshaken and (Envelope.Method <> 'service.status') and
           (Envelope.Method <> 'hello') then
        begin
          StatePayload := FAgent.Snapshot;
          if Envelope.Method = 'desktop.setMode' then
            EventName := 'desktop.changed'
          else
            EventName := 'agent.state';
          EventData := BuildEvent(EventName, StatePayload);
          if not WritePipeMessage(Pipe, EventData) then
            Break;
        end;
      finally
        FreeEnvelope(Envelope);
      end;
    end;
  finally
    Cache.Free;
  end;
end;

procedure TPipeServerThread.Execute;
var
  Attributes: TSecurityAttributes;
  Descriptor: Pointer;
  ErrorText: string;
  SessionId: Cardinal;
  Connected: Boolean;
begin
  while not Terminated do
  begin
    SessionId := FAgent.ResolveActiveSession;
    if not BuildPipeSecurity(SessionId, Attributes, Descriptor, ErrorText) then
    begin
      Sleep(1000);
      Continue;
    end;
    try
      FCurrentPipe := CreateNamedPipeW(PWideChar(REMOTE_PIPE_NAME),
        PIPE_ACCESS_DUPLEX or FILE_FLAG_FIRST_PIPE_INSTANCE,
        PIPE_TYPE_MESSAGE or PIPE_READMODE_MESSAGE or PIPE_WAIT or
        PIPE_REJECT_REMOTE_CLIENTS, 1, REMOTE_MAX_MESSAGE_BYTES,
        REMOTE_MAX_MESSAGE_BYTES, 0, @Attributes);
      if FCurrentPipe = INVALID_HANDLE_VALUE then
      begin
        Sleep(1000);
        Continue;
      end;
      try
        Connected := ConnectNamedPipe(FCurrentPipe, nil) or
          (GetLastError = ERROR_PIPE_CONNECTED);
        if Connected and not Terminated then
          ServeClient(FCurrentPipe);
        DisconnectNamedPipe(FCurrentPipe);
      finally
        CloseHandle(FCurrentPipe);
        FCurrentPipe := INVALID_HANDLE_VALUE;
      end;
    finally
      FreePipeSecurity(Descriptor);
    end;
  end;
end;

end.
