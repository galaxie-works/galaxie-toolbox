program SecurityTests;

{$APPTYPE CONSOLE}

uses
  System.SysUtils,
  RemoteSystem.Security in '..\src\RemoteSystem.Security.pas';

var
  ErrorText: string;
begin
  try
    if ValidateInstalledBinary(ParamStr(0), ErrorText) then
      raise Exception.Create('Unsigned development binary was trusted');
    if ErrorText = '' then
      raise Exception.Create('Fail-closed signature rejection lacked an error');
    Writeln('SecurityTests: PASS (unsigned binary rejected)');
  except
    on E: Exception do
    begin
      Writeln(ErrOutput, 'SecurityTests: FAIL: ', E.Message);
      Halt(1);
    end;
  end;
end.

