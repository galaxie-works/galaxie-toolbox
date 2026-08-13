program PipeIntegrationTests;

{$APPTYPE CONSOLE}
{$DEFINE REMOTE_TESTING}

uses
  System.Classes,
  System.IOUtils,
  System.JSON,
  System.SysUtils,
  Winapi.Windows,
  RemoteSystem.Pipe in '..\src\RemoteSystem.Pipe.pas',
  RemoteSystem.Protocol in '..\src\RemoteSystem.Protocol.pas',
  RemoteSystem.Security in '..\src\RemoteSystem.Security.pas',
  RemoteSystem.Session in '..\src\RemoteSystem.Session.pas';

var
  Failures: Integer;
  ValidatorCalls: Integer;
  ValidatorPid, ValidatorSession: Cardinal;
  ValidatorDirectory: string;

procedure Check(Condition: Boolean; const TestName, MessageText: string);
begin
  if Condition then
    Writeln('PASS ', TestName)
  else
  begin
    Inc(Failures);
    Writeln(ErrOutput, 'FAIL ', TestName, ': ', MessageText);
  end;
end;

function AllowTestClient(Pipe: THandle; ClaimedPid, ClaimedSession: Cardinal;
  const InstallDirectory: string; out ErrorText: string): Boolean;
begin
  Inc(ValidatorCalls);
  ValidatorPid := ClaimedPid;
  ValidatorSession := ClaimedSession;
  ValidatorDirectory := InstallDirectory;
  ErrorText := '';
  Result := True;
end;

type
  TPipeFixture = class
  private
    FAgent: TAgentState;
    FServer: TPipeServerThread;
    FServerHandle, FClientHandle: THandle;
    FThread: TThread;
  public
    constructor Create(const InstallDirectory: string);
    destructor Destroy; override;
    function Exchange(const Json: string; out Response: TBytes): Boolean;
    function ReadResponse(out Response: TBytes): Boolean;
    function WriteRequest(const Json: string): Boolean;
    function IsClosed: Boolean;
  end;

constructor TPipeFixture.Create(const InstallDirectory: string);
var
  PipeName: string;
begin
  inherited Create;
  FServerHandle := INVALID_HANDLE_VALUE;
  FClientHandle := INVALID_HANDLE_VALUE;
  PipeName := Format('\\.\pipe\Galaxie.Remote.QA.%d.%d',
    [GetCurrentProcessId, GetTickCount]);
  FServerHandle := CreateNamedPipeW(PWideChar(PipeName), PIPE_ACCESS_DUPLEX,
    PIPE_TYPE_MESSAGE or PIPE_READMODE_MESSAGE or PIPE_WAIT, 1,
    REMOTE_MAX_MESSAGE_BYTES, REMOTE_MAX_MESSAGE_BYTES, 0, nil);
  if FServerHandle = INVALID_HANDLE_VALUE then
    RaiseLastOSError;

  FAgent := TAgentState.Create(ParamStr(0));
  FServer := TPipeServerThread.Create(FAgent, InstallDirectory);
  FThread := TThread.CreateAnonymousThread(
    procedure
    begin
      if ConnectNamedPipe(FServerHandle, nil) or
         (GetLastError = ERROR_PIPE_CONNECTED) then
      begin
        FServer.ServeClientForTest(FServerHandle);
        FlushFileBuffers(FServerHandle);
        DisconnectNamedPipe(FServerHandle);
      end;
    end);
  FThread.FreeOnTerminate := False;
  FThread.Start;

  FClientHandle := CreateFileW(PWideChar(PipeName), GENERIC_READ or GENERIC_WRITE,
    0, nil, OPEN_EXISTING, 0, 0);
  if FClientHandle = INVALID_HANDLE_VALUE then
    RaiseLastOSError;
end;

destructor TPipeFixture.Destroy;
begin
  if FClientHandle <> INVALID_HANDLE_VALUE then
  begin
    CloseHandle(FClientHandle);
    FClientHandle := INVALID_HANDLE_VALUE;
  end;
  if FThread <> nil then
  begin
    FThread.WaitFor;
    FThread.Free;
  end;
  if FServerHandle <> INVALID_HANDLE_VALUE then
  begin
    DisconnectNamedPipe(FServerHandle);
    CloseHandle(FServerHandle);
  end;
  FServer.Free;
  FAgent.Free;
  inherited;
end;

function TPipeFixture.WriteRequest(const Json: string): Boolean;
var
  Raw: TBytes;
  Written: Cardinal;
begin
  Raw := TEncoding.UTF8.GetBytes(Json);
  Written := 0;
  Result := WriteFile(FClientHandle, Raw[0], Length(Raw), Written, nil) and
    (Written = Cardinal(Length(Raw)));
end;

function TPipeFixture.ReadResponse(out Response: TBytes): Boolean;
var
  Buffer: array[0..REMOTE_MAX_MESSAGE_BYTES - 1] of Byte;
  Read: Cardinal;
begin
  Read := 0;
  Result := ReadFile(FClientHandle, Buffer[0], SizeOf(Buffer), Read, nil) and
    (Read > 0);
  if Result then
  begin
    SetLength(Response, Read);
    Move(Buffer[0], Response[0], Read);
  end
  else
    SetLength(Response, 0);
end;

function TPipeFixture.Exchange(const Json: string; out Response: TBytes): Boolean;
begin
  Result := WriteRequest(Json) and ReadResponse(Response);
end;

function TPipeFixture.IsClosed: Boolean;
var
  Available: Cardinal;
begin
  if WaitForSingleObject(FThread.Handle, 3000) = WAIT_TIMEOUT then
    Exit(False);
  Available := 0;
  Result := not PeekNamedPipe(FClientHandle, nil, 0, nil, @Available, nil);
end;

function JsonText(const Raw: TBytes): string;
begin
  Result := TEncoding.UTF8.GetString(Raw);
end;

function ErrorField(const Raw: TBytes; const Name: string): string;
var
  Root: TJSONValue;
begin
  Result := '';
  Root := TJSONObject.ParseJSONValue(JsonText(Raw));
  try
    if Root <> nil then
      Root.TryGetValue<string>('error.' + Name, Result);
  finally
    Root.Free;
  end;
end;

function CurrentSession: Cardinal;
begin
  Result := 0;
  if not ProcessIdToSessionId(GetCurrentProcessId, Result) then
    RaiseLastOSError;
end;

function Hello(const Id: string; Pid, Session: Cardinal): string;
begin
  Result := Format(
    '{"v":1,"id":"%s","type":"request","method":"hello",' +
    '"payload":{"clientPid":%d,"sessionId":%d,"nonce":"qa"}}',
    [Id, Pid, Session]);
end;

procedure ExpectRejectedHello(const TestName, InstallDirectory: string;
  Pid, Session: Cardinal; const ExpectedReason: string);
var
  Fixture: TPipeFixture;
  Response: TBytes;
begin
  SetPipeClientValidatorForTest(nil);
  Fixture := TPipeFixture.Create(InstallDirectory);
  try
    Check(Fixture.Exchange(Hello(TestName, Pid, Session), Response),
      TestName + '-response', 'server did not return a controlled response');
    Check(ErrorField(Response, 'code') = 'client_rejected', TestName + '-code',
      'wrong error: ' + JsonText(Response));
    Check(Pos(ExpectedReason, ErrorField(Response, 'message')) > 0,
      TestName + '-reason', 'unexpected reason: ' + ErrorField(Response, 'message'));
    Check(Fixture.IsClosed, TestName + '-close',
      'pipe stayed open after client validation failure');
  finally
    Fixture.Free;
  end;
end;

procedure TestRealValidationRejects;
var
  Session: Cardinal;
  ExeDirectory: string;
begin
  Session := CurrentSession;
  ExeDirectory := ExtractFileDir(ParamStr(0));
  ExpectRejectedHello('pid-mismatch', ExeDirectory,
    GetCurrentProcessId + 1, Session, 'PID mismatch');
  ExpectRejectedHello('session-mismatch', ExeDirectory,
    GetCurrentProcessId, Session xor 1, 'session mismatch');
  ExpectRejectedHello('path-mismatch', TPath.GetTempPath,
    GetCurrentProcessId, Session, 'outside the protected installation directory');
  ExpectRejectedHello('authenticode-reject', ExeDirectory,
    GetCurrentProcessId, Session, 'Authenticode trust failed');
end;

procedure TestHandshakeAndIdempotency;
var
  Fixture: TPipeFixture;
  HelloResponse, FirstResponse, ReplayedResponse: TBytes;
  Session: Cardinal;
  InstallDirectory: string;
begin
  Session := CurrentSession;
  InstallDirectory := ExtractFileDir(ParamStr(0));
  ValidatorCalls := 0;
  SetPipeClientValidatorForTest(AllowTestClient);
  Fixture := TPipeFixture.Create(InstallDirectory);
  try
    Check(Fixture.Exchange(Hello('hello-ok', GetCurrentProcessId, Session),
      HelloResponse), 'handshake-response', 'hello did not receive helloAck');
    Check(Pos('"kind":"helloAck"', JsonText(HelloResponse)) > 0,
      'handshake-ack', 'helloAck missing: ' + JsonText(HelloResponse));
    Check((ValidatorCalls = 1) and (ValidatorPid = GetCurrentProcessId) and
      (ValidatorSession = Session) and (ValidatorDirectory = InstallDirectory),
      'validator-bindings', 'ServeClient did not pass all claimed bindings');

    Check(Fixture.Exchange(
      '{"v":1,"id":"same-id","type":"request",' +
      '"method":"service.status","payload":{}}', FirstResponse),
      'idempotency-first', 'first request failed');
    Check(Fixture.Exchange(
      '{"v":1,"id":"same-id","type":"request",' +
      '"method":"shell.exec","payload":{}}', ReplayedResponse),
      'idempotency-replay', 'replayed request failed');
    Check((Length(FirstResponse) = Length(ReplayedResponse)) and
      (Length(FirstResponse) > 0) and
      CompareMem(@FirstResponse[0], @ReplayedResponse[0], Length(FirstResponse)),
      'idempotency-by-id', 'same id did not replay the exact cached response');
  finally
    Fixture.Free;
    SetPipeClientValidatorForTest(nil);
  end;
end;

procedure TestHandshakeFailuresClose;
var
  Fixture: TPipeFixture;
  Response: TBytes;
begin
  ValidatorCalls := 0;
  SetPipeClientValidatorForTest(AllowTestClient);
  Fixture := TPipeFixture.Create(ExtractFileDir(ParamStr(0)));
  try
    Check(Fixture.Exchange(
      '{"v":1,"id":"prehello","type":"request",' +
      '"method":"service.status","payload":{}}', Response),
      'handshake-required-response', 'missing rejection response');
    Check(ErrorField(Response, 'code') = 'handshake_required',
      'handshake-required-code', 'wrong response: ' + JsonText(Response));
    Check((ValidatorCalls = 0) and Fixture.IsClosed,
      'handshake-required-close', 'validator ran or pipe stayed open');
  finally
    Fixture.Free;
  end;

  Fixture := TPipeFixture.Create(ExtractFileDir(ParamStr(0)));
  try
    Check(Fixture.Exchange(
      '{"v":2,"id":"wrong-v","type":"request",' +
      '"method":"hello","payload":{}}', Response),
      'version-response', 'missing protocol-version response');
    Check(ErrorField(Response, 'code') = 'protocol_version',
      'version-code', 'wrong response: ' + JsonText(Response));
    Check(Fixture.IsClosed, 'version-close',
      'pipe stayed open after incompatible version');
  finally
    Fixture.Free;
    SetPipeClientValidatorForTest(nil);
  end;
end;

begin
  Failures := 0;
  try
    TestRealValidationRejects;
    TestHandshakeFailuresClose;
    TestHandshakeAndIdempotency;
  except
    on E: Exception do
    begin
      Inc(Failures);
      Writeln(ErrOutput, 'FAIL unhandled: ', E.ClassName, ': ', E.Message);
    end;
  end;
  if Failures = 0 then
  begin
    Writeln('PipeIntegrationTests: PASS');
    Halt(0);
  end;
  Writeln(ErrOutput, 'PipeIntegrationTests: FAIL (', Failures, ' checks failed)');
  Halt(1);
end.
