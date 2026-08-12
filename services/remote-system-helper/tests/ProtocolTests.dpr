program ProtocolTests;

{$APPTYPE CONSOLE}

uses
  System.JSON,
  System.SysUtils,
  RemoteSystem.Protocol in '..\src\RemoteSystem.Protocol.pas';

procedure Check(Condition: Boolean; const MessageText: string);
begin
  if not Condition then
    raise Exception.Create(MessageText);
end;

procedure TestHello;
var
  Envelope: TRemoteEnvelope;
  Code, MessageText: string;
  Raw: TBytes;
begin
  Raw := TEncoding.UTF8.GetBytes(
    '{"v":1,"id":"abc","type":"request","method":"hello",' +
    '"payload":{"clientPid":42,"sessionId":1,"nonce":"n"}}');
  Check(ParseRequest(Raw, Envelope, Code, MessageText), Code + ': ' + MessageText);
  try
    Check(Envelope.Version = 1, 'version');
    Check(Envelope.Id = 'abc', 'id');
    Check(Envelope.Method = 'hello', 'method');
    Check(Envelope.Payload.GetValue<Integer>('clientPid') = 42, 'clientPid');
  finally
    FreeEnvelope(Envelope);
  end;
end;

procedure TestRejectsUnknownVersion;
var
  Envelope: TRemoteEnvelope;
  Code, MessageText: string;
begin
  Check(not ParseRequest(TEncoding.UTF8.GetBytes(
    '{"v":2,"id":"abc","type":"request","method":"hello","payload":{}}'),
    Envelope, Code, MessageText), 'version 2 accepted');
  Check(Code = 'protocol_version', 'wrong error code');
end;

procedure TestAllowlist;
begin
  Check(IsAllowedMethod('service.status'), 'status');
  Check(IsAllowedMethod('agent.ensure'), 'ensure');
  Check(IsAllowedMethod('agent.stop'), 'stop');
  Check(IsAllowedMethod('desktop.setMode'), 'desktop');
  Check(not IsAllowedMethod('shell.exec'), 'generic shell accepted');
end;

begin
  try
    TestHello;
    TestRejectsUnknownVersion;
    TestAllowlist;
    Writeln('ProtocolTests: PASS');
  except
    on E: Exception do
    begin
      Writeln(ErrOutput, 'ProtocolTests: FAIL: ', E.Message);
      Halt(1);
    end;
  end;
end.

