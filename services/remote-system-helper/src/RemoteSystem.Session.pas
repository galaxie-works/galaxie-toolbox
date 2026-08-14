unit RemoteSystem.Session;

interface

uses
  System.JSON,
  System.SyncObjs,
  System.SysUtils,
  Winapi.Windows;

type
  TDesktopMode = (dmAuto, dmDefault, dmWinlogon);

  TAgentState = class
  private
    FLock: TCriticalSection;
    FProcessHandle: THandle;
    FProcessId: Cardinal;
    FStopEvent: THandle;
    FSessionId: Cardinal;
    FDesktopMode: TDesktopMode;
    FWorkerPath: string;
    FLastError: string;
    FWantsRunning: Boolean;
    FFollowActiveSession: Boolean;
    function LaunchAgent(SessionId: Cardinal; Mode: TDesktopMode): Boolean;
    procedure CloseAgentHandles;
  public
    constructor Create(const WorkerPath: string);
    destructor Destroy; override;
    function ResolveActiveSession: Cardinal;
    function EnsureAgent(RequestedSession: Cardinal; HasRequestedSession: Boolean;
      out ErrorText: string): Boolean;
    function StopAgent(SessionId: Cardinal; out ErrorText: string): Boolean;
    function SetDesktopMode(SessionId: Cardinal; Mode: TDesktopMode;
      out ErrorText: string): Boolean;
    procedure Tick;
    function Snapshot: TJSONObject;
  end;

function DesktopModeFromString(const Value: string; out Mode: TDesktopMode): Boolean;
function DesktopModeToString(Mode: TDesktopMode): string;

implementation

uses
  System.IOUtils,
  RemoteSystem.Security,
  Winapi.UserEnv,
  Winapi.WtsApi32;

const
  NO_SESSION = Cardinal($FFFFFFFF);

function DesktopModeFromString(const Value: string; out Mode: TDesktopMode): Boolean;
begin
  Result := True;
  if SameText(Value, 'auto') then
    Mode := dmAuto
  else if SameText(Value, 'default') then
    Mode := dmDefault
  else if SameText(Value, 'winlogon') then
    Mode := dmWinlogon
  else
    Result := False;
end;

function DesktopModeToString(Mode: TDesktopMode): string;
begin
  case Mode of
    dmAuto: Result := 'auto';
    dmDefault: Result := 'default';
    dmWinlogon: Result := 'winlogon';
  else
    Result := 'auto';
  end;
end;

function EnablePrivilege(Token: THandle; const Name: PWideChar): Boolean;
var
  Luid: TLargeInteger;
  Privileges: TTokenPrivileges;
  ReturnLength: Cardinal;
begin
  Result := LookupPrivilegeValue(nil, Name, Luid);
  if not Result then
    Exit;
  ZeroMemory(@Privileges, SizeOf(Privileges));
  Privileges.PrivilegeCount := 1;
  Privileges.Privileges[0].Luid := Luid;
  Privileges.Privileges[0].Attributes := SE_PRIVILEGE_ENABLED;
  ReturnLength := 0;
  Result := AdjustTokenPrivileges(Token, False, Privileges, 0,
    PTokenPrivileges(nil), ReturnLength) and
    (GetLastError = ERROR_SUCCESS);
end;

function FindActiveSession: Cardinal;
var
  Sessions: PWTS_SESSION_INFO;
  SessionInfo: PWTS_SESSION_INFO;
  Count, I: Cardinal;
  ConsoleId: Cardinal;
begin
  ConsoleId := WTSGetActiveConsoleSessionId;
  if ConsoleId <> NO_SESSION then
    Result := ConsoleId
  else
    Result := NO_SESSION;

  Sessions := nil;
  Count := 0;
  if WTSEnumerateSessions(WTS_CURRENT_SERVER_HANDLE, 0, 1, Sessions, Count) then
  try
    for I := 0 to Count - 1 do
    begin
      SessionInfo := PWTS_SESSION_INFO(PByte(Sessions) +
        (I * SizeOf(WTS_SESSION_INFO)));
      if SessionInfo.State = WTSActive then
      begin
        if (Result = NO_SESSION) or
           ((Result = 0) and (SessionInfo.SessionId <> 0)) then
          Result := SessionInfo.SessionId;
      end;
    end;
  finally
    WTSFreeMemory(Sessions);
  end;
end;

constructor TAgentState.Create(const WorkerPath: string);
begin
  inherited Create;
  FLock := TCriticalSection.Create;
  FProcessHandle := 0;
  FProcessId := 0;
  FStopEvent := 0;
  FSessionId := NO_SESSION;
  FDesktopMode := dmAuto;
  FWorkerPath := TPath.GetFullPath(WorkerPath);
  FWantsRunning := False;
  FFollowActiveSession := True;
end;

destructor TAgentState.Destroy;
var
  Ignored: string;
begin
  StopAgent(FSessionId, Ignored);
  FLock.Free;
  inherited;
end;

function TAgentState.ResolveActiveSession: Cardinal;
begin
  Result := FindActiveSession;
end;

procedure TAgentState.CloseAgentHandles;
begin
  if FProcessHandle <> 0 then
    CloseHandle(FProcessHandle);
  if FStopEvent <> 0 then
    CloseHandle(FStopEvent);
  FProcessHandle := 0;
  FProcessId := 0;
  FStopEvent := 0;
  FSessionId := NO_SESSION;
end;

function TAgentState.LaunchAgent(SessionId: Cardinal; Mode: TDesktopMode): Boolean;
var
  ServiceToken, PrimaryToken, UserToken: THandle;
  Startup: TStartupInfoW;
  ProcessInfo: TProcessInformation;
  Environment: Pointer;
  DesktopName, EventName, CommandLine, WorkingDir: string;
  MutableCommand: TArray<WideChar>;
  Flags: Cardinal;
begin
  Result := False;
  ServiceToken := 0;
  PrimaryToken := 0;
  UserToken := 0;
  Environment := nil;
  FLastError := '';

  if not FileExists(FWorkerPath) then
  begin
    FLastError := 'Fixed worker executable is missing: ' + FWorkerPath;
    Exit;
  end;
  if not ValidateInstalledBinary(FWorkerPath, FLastError) then
    Exit;

  if not OpenProcessToken(GetCurrentProcess,
    TOKEN_QUERY or TOKEN_DUPLICATE or TOKEN_ASSIGN_PRIMARY or
    TOKEN_ADJUST_DEFAULT or TOKEN_ADJUST_SESSIONID, ServiceToken) then
  begin
    FLastError := SysErrorMessage(GetLastError);
    Exit;
  end;
  try
    EnablePrivilege(ServiceToken, SE_ASSIGNPRIMARYTOKEN_NAME);
    EnablePrivilege(ServiceToken, SE_INCREASE_QUOTA_NAME);
    EnablePrivilege(ServiceToken, SE_TCB_NAME);

    if not DuplicateTokenEx(ServiceToken, MAXIMUM_ALLOWED, nil,
      SecurityImpersonation, TokenPrimary, PrimaryToken) then
    begin
      FLastError := 'DuplicateTokenEx: ' + SysErrorMessage(GetLastError);
      Exit;
    end;
    try
      if not SetTokenInformation(PrimaryToken, TokenSessionId, @SessionId,
        SizeOf(SessionId)) then
      begin
        FLastError := 'SetTokenInformation(TokenSessionId): ' +
          SysErrorMessage(GetLastError);
        Exit;
      end;

      if WTSQueryUserToken(SessionId, UserToken) then
      begin
        if not CreateEnvironmentBlock(Environment, UserToken, False) then
          Environment := nil;
      end
      else if not CreateEnvironmentBlock(Environment, PrimaryToken, False) then
        Environment := nil;

      case Mode of
        dmWinlogon: DesktopName := 'winsta0\winlogon';
      else
        DesktopName := 'winsta0\default';
      end;

      EventName := Format('Global\Galaxie.Remote.Agent.Stop.%d', [SessionId]);
      FStopEvent := CreateEvent(nil, True, False, PWideChar(EventName));
      if FStopEvent = 0 then
      begin
        FLastError := 'CreateEvent: ' + SysErrorMessage(GetLastError);
        Exit;
      end;

      CommandLine := Format('"%s" --session-id %d --desktop %s --stop-event "%s"',
        [FWorkerPath, SessionId, DesktopModeToString(Mode), EventName]);
      MutableCommand := (CommandLine + #0).ToCharArray;
      WorkingDir := ExtractFileDir(FWorkerPath);
      ZeroMemory(@Startup, SizeOf(Startup));
      Startup.cb := SizeOf(Startup);
      Startup.lpDesktop := PWideChar(DesktopName);
      ZeroMemory(@ProcessInfo, SizeOf(ProcessInfo));
      Flags := CREATE_UNICODE_ENVIRONMENT or CREATE_NO_WINDOW;

      if not CreateProcessAsUserW(PrimaryToken, PWideChar(FWorkerPath),
        PWideChar(MutableCommand), nil, nil, False, Flags, Environment,
        PWideChar(WorkingDir), Startup, ProcessInfo) then
      begin
        FLastError := 'CreateProcessAsUser: ' + SysErrorMessage(GetLastError);
        CloseHandle(FStopEvent);
        FStopEvent := 0;
        Exit;
      end;

      CloseHandle(ProcessInfo.hThread);
      FProcessHandle := ProcessInfo.hProcess;
      FProcessId := ProcessInfo.dwProcessId;
      FSessionId := SessionId;
      FDesktopMode := Mode;
      Result := True;
    finally
      if Environment <> nil then
        DestroyEnvironmentBlock(Environment);
      if UserToken <> 0 then
        CloseHandle(UserToken);
      CloseHandle(PrimaryToken);
    end;
  finally
    CloseHandle(ServiceToken);
  end;
end;

function TAgentState.EnsureAgent(RequestedSession: Cardinal;
  HasRequestedSession: Boolean; out ErrorText: string): Boolean;
var
  SessionId: Cardinal;
  ExitCode: Cardinal;
begin
  FLock.Acquire;
  try
    FWantsRunning := True;
    FFollowActiveSession := not HasRequestedSession;
    if HasRequestedSession then
      SessionId := RequestedSession
    else
      SessionId := ResolveActiveSession;

    if SessionId = NO_SESSION then
    begin
      ErrorText := 'No active interactive session';
      Exit(False);
    end;

    if (FProcessHandle <> 0) and GetExitCodeProcess(FProcessHandle, ExitCode) and
       (ExitCode = STILL_ACTIVE) and (FSessionId = SessionId) then
    begin
      ErrorText := '';
      Exit(True);
    end;

    if FProcessHandle <> 0 then
    begin
      if FStopEvent <> 0 then
        SetEvent(FStopEvent);
      if WaitForSingleObject(FProcessHandle, 5000) = WAIT_TIMEOUT then
        TerminateProcess(FProcessHandle, ERROR_PROCESS_ABORTED);
      CloseAgentHandles;
    end;

    Result := LaunchAgent(SessionId, FDesktopMode);
    ErrorText := FLastError;
  finally
    FLock.Release;
  end;
end;

function TAgentState.StopAgent(SessionId: Cardinal; out ErrorText: string): Boolean;
begin
  FLock.Acquire;
  try
    if FProcessHandle = 0 then
    begin
      FWantsRunning := False;
      ErrorText := '';
      Exit(True);
    end;
    if (SessionId <> NO_SESSION) and (SessionId <> FSessionId) then
    begin
      ErrorText := 'Requested session does not own the running worker';
      Exit(False);
    end;
    FWantsRunning := False;
    if FStopEvent <> 0 then
      SetEvent(FStopEvent);
    if WaitForSingleObject(FProcessHandle, 5000) = WAIT_TIMEOUT then
      TerminateProcess(FProcessHandle, ERROR_PROCESS_ABORTED);
    CloseAgentHandles;
    ErrorText := '';
    Result := True;
  finally
    FLock.Release;
  end;
end;

function TAgentState.SetDesktopMode(SessionId: Cardinal; Mode: TDesktopMode;
  out ErrorText: string): Boolean;
var
  WasRunning: Boolean;
begin
  FLock.Acquire;
  try
    WasRunning := FProcessHandle <> 0;
  finally
    FLock.Release;
  end;

  if WasRunning and not StopAgent(SessionId, ErrorText) then
    Exit(False);

  FLock.Acquire;
  try
    FDesktopMode := Mode;
  finally
    FLock.Release;
  end;

  if WasRunning then
    Result := EnsureAgent(SessionId, True, ErrorText)
  else
  begin
    ErrorText := '';
    Result := True;
  end;
end;

procedure TAgentState.Tick;
var
  ExitCode, CurrentSession, PreviousSession: Cardinal;
  ShouldRestart: Boolean;
  ErrorText: string;
begin
  ShouldRestart := False;
  PreviousSession := NO_SESSION;
  FLock.Acquire;
  try
    if (FProcessHandle <> 0) and GetExitCodeProcess(FProcessHandle, ExitCode) and
       (ExitCode <> STILL_ACTIVE) then
    begin
      FLastError := Format('Worker exited with code %d', [ExitCode]);
      CloseAgentHandles;
    end;
    if FWantsRunning and FFollowActiveSession then
    begin
      CurrentSession := ResolveActiveSession;
      if (CurrentSession <> NO_SESSION) and
         ((FProcessHandle = 0) or (FSessionId <> CurrentSession)) then
      begin
        PreviousSession := FSessionId;
        ShouldRestart := True;
      end;
    end;
  finally
    FLock.Release;
  end;

  if ShouldRestart then
  begin
    if PreviousSession <> NO_SESSION then
      StopAgent(PreviousSession, ErrorText);
    EnsureAgent(0, False, ErrorText);
  end;
end;

function TAgentState.Snapshot: TJSONObject;
var
  Running: Boolean;
  ExitCode: Cardinal;
  ActiveSession: Cardinal;
begin
  FLock.Acquire;
  try
    Running := (FProcessHandle <> 0) and GetExitCodeProcess(FProcessHandle, ExitCode) and
      (ExitCode = STILL_ACTIVE);
    ActiveSession := ResolveActiveSession;
    Result := TJSONObject.Create;
    Result.AddPair('service', 'running');
    Result.AddPair('agentRunning', TJSONBool.Create(Running));
    if FSessionId <> NO_SESSION then
      Result.AddPair('agentSessionId', TJSONNumber.Create(FSessionId))
    else
      Result.AddPair('agentSessionId', TJSONNull.Create);
    if ActiveSession <> NO_SESSION then
      Result.AddPair('activeSessionId', TJSONNumber.Create(ActiveSession))
    else
      Result.AddPair('activeSessionId', TJSONNull.Create);
    Result.AddPair('desktopMode', DesktopModeToString(FDesktopMode));
    Result.AddPair('workerPid', TJSONNumber.Create(FProcessId));
    Result.AddPair('lastError', FLastError);
  finally
    FLock.Release;
  end;
end;

end.
