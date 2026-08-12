unit RemoteSystem.Service;

interface

procedure RunServiceDispatcher;
procedure RunConsole;
procedure InstallService;
procedure UninstallService;
procedure StartInstalledService;
procedure StopInstalledService;
procedure PrintInstalledServiceStatus;

implementation

uses
  System.IOUtils,
  System.SysUtils,
  RemoteSystem.Pipe,
  RemoteSystem.Session,
  Winapi.Windows,
  Winapi.WinSvc;

const
  SERVICE_NAME = 'GalaxieRemoteSystem';
  SERVICE_DISPLAY_NAME = 'GALAXIE Remote SYSTEM Helper';

var
  ServiceStatusHandle: SERVICE_STATUS_HANDLE;
  ServiceStatus: TServiceStatus;
  ServiceStopEvent: THandle;
  AgentState: TAgentState;
  PipeThread: TPipeServerThread;

procedure SetServiceState(State, Win32ExitCode, WaitHint: Cardinal);
begin
  ServiceStatus.dwCurrentState := State;
  ServiceStatus.dwWin32ExitCode := Win32ExitCode;
  ServiceStatus.dwWaitHint := WaitHint;
  if State in [SERVICE_START_PENDING, SERVICE_STOP_PENDING] then
    Inc(ServiceStatus.dwCheckPoint)
  else
    ServiceStatus.dwCheckPoint := 0;
  if ServiceStatusHandle <> 0 then
    SetServiceStatus(ServiceStatusHandle, ServiceStatus);
end;

function ServiceControlHandler(Control, EventType: Cardinal; EventData,
  Context: Pointer): Cardinal; stdcall;
begin
  Result := NO_ERROR;
  case Control of
    SERVICE_CONTROL_STOP, SERVICE_CONTROL_SHUTDOWN:
      begin
        SetServiceState(SERVICE_STOP_PENDING, NO_ERROR, 10000);
        SetEvent(ServiceStopEvent);
      end;
    SERVICE_CONTROL_SESSIONCHANGE:
      begin
        if AgentState <> nil then
          AgentState.Tick;
      end;
    SERVICE_CONTROL_INTERROGATE:
      SetServiceStatus(ServiceStatusHandle, ServiceStatus);
  else
    Result := ERROR_CALL_NOT_IMPLEMENTED;
  end;
end;

procedure RunBrokerLoop(ReportToScm: Boolean);
var
  WorkerPath, InstallDirectory, ErrorText: string;
begin
  InstallDirectory := ExtractFileDir(ParamStr(0));
  WorkerPath := TPath.Combine(InstallDirectory, 'galaxie-remote-agent.exe');
  ServiceStopEvent := CreateEvent(nil, True, False, nil);
  if ServiceStopEvent = 0 then
    RaiseLastOSError;
  AgentState := TAgentState.Create(WorkerPath);
  PipeThread := TPipeServerThread.Create(AgentState, InstallDirectory);
  try
    PipeThread.Start;
    AgentState.EnsureAgent(0, False, ErrorText);
    if ReportToScm then
      SetServiceState(SERVICE_RUNNING, NO_ERROR, 0);
    while WaitForSingleObject(ServiceStopEvent, 1000) = WAIT_TIMEOUT do
      AgentState.Tick;

    PipeThread.RequestStop;
    PipeThread.WaitFor;
    AgentState.StopAgent(Cardinal($FFFFFFFF), ErrorText);
  finally
    PipeThread.Free;
    PipeThread := nil;
    AgentState.Free;
    AgentState := nil;
    CloseHandle(ServiceStopEvent);
    ServiceStopEvent := 0;
  end;
end;

procedure ServiceMain(ArgCount: Cardinal; Args: PLPWSTR); stdcall;
begin
  ZeroMemory(@ServiceStatus, SizeOf(ServiceStatus));
  ServiceStatus.dwServiceType := SERVICE_WIN32_OWN_PROCESS;
  ServiceStatus.dwControlsAccepted := SERVICE_ACCEPT_STOP or
    SERVICE_ACCEPT_SHUTDOWN or SERVICE_ACCEPT_SESSIONCHANGE;
  ServiceStatusHandle := RegisterServiceCtrlHandlerExW(SERVICE_NAME,
    ServiceControlHandler, nil);
  if ServiceStatusHandle = 0 then
    Exit;
  SetServiceState(SERVICE_START_PENDING, NO_ERROR, 10000);
  try
    RunBrokerLoop(True);
    SetServiceState(SERVICE_STOPPED, NO_ERROR, 0);
  except
    on E: Exception do
      SetServiceState(SERVICE_STOPPED, ERROR_SERVICE_SPECIFIC_ERROR, 0);
  end;
end;

procedure RunServiceDispatcher;
var
  Table: array[0..1] of TServiceTableEntryW;
begin
  ZeroMemory(@Table, SizeOf(Table));
  Table[0].lpServiceName := SERVICE_NAME;
  Table[0].lpServiceProc := ServiceMain;
  if not StartServiceCtrlDispatcherW(@Table[0]) then
    RaiseLastOSError;
end;

procedure ConsoleControlHandler(ControlType: Cardinal); stdcall;
begin
  if ControlType in [CTRL_C_EVENT, CTRL_BREAK_EVENT, CTRL_CLOSE_EVENT,
    CTRL_SHUTDOWN_EVENT] then
    SetEvent(ServiceStopEvent);
end;

procedure RunConsole;
begin
  Writeln('GALAXIE Remote SYSTEM Helper console mode. Ctrl+C to stop.');
  SetConsoleCtrlHandler(@ConsoleControlHandler, True);
  RunBrokerLoop(False);
end;

function OpenServiceManager(Access: Cardinal): SC_HANDLE;
begin
  Result := OpenSCManager(nil, nil, Access);
  if Result = 0 then
    RaiseLastOSError;
end;

function OpenInstalledService(Manager: SC_HANDLE; Access: Cardinal): SC_HANDLE;
begin
  Result := OpenService(Manager, SERVICE_NAME, Access);
  if Result = 0 then
    RaiseLastOSError;
end;

procedure InstallService;
var
  Manager, Service: SC_HANDLE;
  BinaryPath: string;
  Delayed: SERVICE_DELAYED_AUTO_START_INFO;
  Actions: array[0..2] of SC_ACTION;
  FailureActions: SERVICE_FAILURE_ACTIONS;
  FailureFlag: SERVICE_FAILURE_ACTIONS_FLAG;
  Description: SERVICE_DESCRIPTION;
  SidInfo: SERVICE_SID_INFO;
begin
  BinaryPath := '"' + TPath.GetFullPath(ParamStr(0)) + '"';
  Manager := OpenServiceManager(SC_MANAGER_CREATE_SERVICE);
  try
    Service := CreateServiceW(Manager, SERVICE_NAME, SERVICE_DISPLAY_NAME,
      SERVICE_ALL_ACCESS, SERVICE_WIN32_OWN_PROCESS, SERVICE_AUTO_START,
      SERVICE_ERROR_NORMAL, PWideChar(BinaryPath), nil, nil, nil, nil, nil);
    if Service = 0 then
      RaiseLastOSError;
    try
      Delayed.fDelayedAutostart := True;
      if not ChangeServiceConfig2W(Service,
        SERVICE_CONFIG_DELAYED_AUTO_START_INFO, @Delayed) then
        RaiseLastOSError;

      Actions[0].&Type := SC_ACTION_RESTART;
      Actions[0].Delay := 5000;
      Actions[1].&Type := SC_ACTION_RESTART;
      Actions[1].Delay := 10000;
      Actions[2].&Type := SC_ACTION_RESTART;
      Actions[2].Delay := 30000;
      ZeroMemory(@FailureActions, SizeOf(FailureActions));
      FailureActions.dwResetPeriod := 86400;
      FailureActions.cActions := Length(Actions);
      FailureActions.lpsaActions := @Actions[0];
      if not ChangeServiceConfig2W(Service, SERVICE_CONFIG_FAILURE_ACTIONS,
        @FailureActions) then
        RaiseLastOSError;

      FailureFlag.fFailureActionsOnNonCrashFailures := 1;
      if not ChangeServiceConfig2W(Service,
        SERVICE_CONFIG_FAILURE_ACTIONS_FLAG, @FailureFlag) then
        RaiseLastOSError;

      Description.lpDescription :=
        'Privileged broker for GALAXIE Remote secure-desktop sessions.';
      if not ChangeServiceConfig2W(Service, SERVICE_CONFIG_DESCRIPTION,
        @Description) then
        RaiseLastOSError;

      SidInfo.dwServiceSidType := SERVICE_SID_TYPE_UNRESTRICTED;
      if not ChangeServiceConfig2W(Service, SERVICE_CONFIG_SERVICE_SID_INFO,
        @SidInfo) then
        RaiseLastOSError;
      Writeln('Service installed.');
    finally
      CloseServiceHandle(Service);
    end;
  finally
    CloseServiceHandle(Manager);
  end;
end;

procedure UninstallService;
var
  Manager, Service: SC_HANDLE;
  Status: TServiceStatus;
begin
  Manager := OpenServiceManager(SC_MANAGER_CONNECT);
  try
    Service := OpenInstalledService(Manager, SERVICE_STOP or $00010000 or
      SERVICE_QUERY_STATUS);
    try
      ControlService(Service, SERVICE_CONTROL_STOP, Status);
      if not DeleteService(Service) then
        RaiseLastOSError;
      Writeln('Service removed.');
    finally
      CloseServiceHandle(Service);
    end;
  finally
    CloseServiceHandle(Manager);
  end;
end;

procedure StartInstalledService;
var
  Manager, Service: SC_HANDLE;
  NoArguments: LPCWSTR;
begin
  Manager := OpenServiceManager(SC_MANAGER_CONNECT);
  try
    Service := OpenInstalledService(Manager, SERVICE_START);
    try
      NoArguments := nil;
      if not StartServiceW(Service, 0, NoArguments) and
         (GetLastError <> ERROR_SERVICE_ALREADY_RUNNING) then
        RaiseLastOSError;
      Writeln('Service start requested.');
    finally
      CloseServiceHandle(Service);
    end;
  finally
    CloseServiceHandle(Manager);
  end;
end;

procedure StopInstalledService;
var
  Manager, Service: SC_HANDLE;
  Status: TServiceStatus;
begin
  Manager := OpenServiceManager(SC_MANAGER_CONNECT);
  try
    Service := OpenInstalledService(Manager, SERVICE_STOP or SERVICE_QUERY_STATUS);
    try
      if not ControlService(Service, SERVICE_CONTROL_STOP, Status) and
         (GetLastError <> ERROR_SERVICE_NOT_ACTIVE) then
        RaiseLastOSError;
      Writeln('Service stop requested.');
    finally
      CloseServiceHandle(Service);
    end;
  finally
    CloseServiceHandle(Manager);
  end;
end;

procedure PrintInstalledServiceStatus;
var
  Manager, Service: SC_HANDLE;
  Status: SERVICE_STATUS_PROCESS;
  Needed: Cardinal;
begin
  Manager := OpenServiceManager(SC_MANAGER_CONNECT);
  try
    Service := OpenInstalledService(Manager, SERVICE_QUERY_STATUS);
    try
      Needed := 0;
      if not QueryServiceStatusEx(Service, SC_STATUS_PROCESS_INFO, @Status,
        SizeOf(Status), Needed) then
        RaiseLastOSError;
      Writeln(Format('state=%d pid=%d exit=%d', [Status.dwCurrentState,
        Status.dwProcessId, Status.dwWin32ExitCode]));
    finally
      CloseServiceHandle(Service);
    end;
  finally
    CloseServiceHandle(Manager);
  end;
end;

end.
