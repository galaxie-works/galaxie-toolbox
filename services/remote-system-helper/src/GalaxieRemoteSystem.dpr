program GalaxieRemoteSystem;

{$APPTYPE CONSOLE}

uses
  System.SysUtils,
  RemoteSystem.Protocol in 'RemoteSystem.Protocol.pas',
  RemoteSystem.Security in 'RemoteSystem.Security.pas',
  RemoteSystem.Session in 'RemoteSystem.Session.pas',
  RemoteSystem.Pipe in 'RemoteSystem.Pipe.pas',
  RemoteSystem.Service in 'RemoteSystem.Service.pas';

procedure PrintUsage;
begin
  Writeln('GalaxieRemoteSystem [--console|--install|--uninstall|--start|--stop|--status]');
end;

begin
  try
    if ParamCount = 0 then
      RunServiceDispatcher
    else if SameText(ParamStr(1), '--console') then
      RunConsole
    else if SameText(ParamStr(1), '--install') then
      InstallService
    else if SameText(ParamStr(1), '--uninstall') then
      UninstallService
    else if SameText(ParamStr(1), '--start') then
      StartInstalledService
    else if SameText(ParamStr(1), '--stop') then
      StopInstalledService
    else if SameText(ParamStr(1), '--status') then
      PrintInstalledServiceStatus
    else
    begin
      PrintUsage;
      Halt(2);
    end;
  except
    on E: Exception do
    begin
      Writeln(ErrOutput, E.ClassName, ': ', E.Message);
      Halt(1);
    end;
  end;
end.

