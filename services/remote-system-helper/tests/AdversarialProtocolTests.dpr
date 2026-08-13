program AdversarialProtocolTests;

{$APPTYPE CONSOLE}

uses
  System.SysUtils,
  RemoteSystem.Protocol in '..\src\RemoteSystem.Protocol.pas';

var
  Failures: Integer;

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

function Parse(const Raw: TBytes; out ErrorCode: string): Boolean;
var
  Envelope: TRemoteEnvelope;
  ErrorMessage: string;
begin
  try
    Result := ParseRequest(Raw, Envelope, ErrorCode, ErrorMessage);
    if Result then
      FreeEnvelope(Envelope);
  except
    on E: Exception do
    begin
      ErrorCode := 'unhandled_exception:' + E.ClassName;
      Result := False;
    end;
  end;
end;

procedure TestMessageBounds;
var
  Base, Raw: TBytes;
  ErrorCode: string;
begin
  Check(not Parse(nil, ErrorCode) and (ErrorCode = 'message_size'),
    'empty-message', 'zero bytes were not rejected as message_size');

  Base := TEncoding.UTF8.GetBytes(
    '{"v":1,"id":"limit","type":"request","method":"service.status","payload":{}}');
  SetLength(Raw, REMOTE_MAX_MESSAGE_BYTES);
  FillChar(Raw[0], Length(Raw), Ord(' '));
  Move(Base[0], Raw[0], Length(Base));
  Check(Parse(Raw, ErrorCode), 'exact-64k',
    'an exactly 65536-byte request was rejected: ' + ErrorCode);

  SetLength(Raw, REMOTE_MAX_MESSAGE_BYTES + 1);
  FillChar(Raw[0], Length(Raw), Ord(' '));
  Move(Base[0], Raw[0], Length(Base));
  Check(not Parse(Raw, ErrorCode) and (ErrorCode = 'message_size'),
    'over-64k', 'a 65537-byte request was not rejected as message_size');
end;

procedure TestEnvelopeShape;
var
  ErrorCode: string;
begin
  Check(not Parse(TEncoding.UTF8.GetBytes('[]'), ErrorCode) and
    (ErrorCode = 'invalid_json'), 'root-array',
    'a non-object root was accepted');
  Check(not Parse(TEncoding.UTF8.GetBytes(
    '{"v":1,"id":"x","type":"response","method":"service.status","payload":{}}'),
    ErrorCode) and (ErrorCode = 'message_type'), 'response-as-request',
    'a response envelope was accepted as a request');
  Check(not Parse(TEncoding.UTF8.GetBytes(
    '{"v":1,"id":"x","type":"request","method":"service.status","payload":"not-an-object"}'),
    ErrorCode), 'string-payload',
    'a scalar payload was silently normalized instead of rejected');
  Check(not Parse(TEncoding.UTF8.GetBytes(
    '{"v":1,"id":"x","type":"request","method":"service.status","payload":[]}'),
    ErrorCode), 'array-payload',
    'an array payload was silently normalized instead of rejected');
end;

procedure TestInvalidUtf8;
var
  Prefix, Suffix, Raw: TBytes;
  Offset: Integer;
  ErrorCode: string;
begin
  Prefix := TEncoding.UTF8.GetBytes('{"v":1,"id":"');
  Suffix := TEncoding.UTF8.GetBytes(
    '","type":"request","method":"service.status","payload":{}}');
  SetLength(Raw, Length(Prefix) + 4 + Length(Suffix));
  Move(Prefix[0], Raw[0], Length(Prefix));
  Offset := Length(Prefix);
  Raw[Offset] := $F0;
  Raw[Offset + 1] := $28;
  Raw[Offset + 2] := $8C;
  Raw[Offset + 3] := $28;
  Move(Suffix[0], Raw[Offset + 4], Length(Suffix));
  Check(not Parse(Raw, ErrorCode) and
    not ErrorCode.StartsWith('unhandled_exception:'), 'invalid-utf8',
    'malformed UTF-8 escaped the parser boundary: ' + ErrorCode);
end;

procedure TestIdentifiersAndAllowlist;
var
  ErrorCode: string;
begin
  Check(not Parse(TEncoding.UTF8.GetBytes(
    '{"v":1,"id":"' + StringOfChar('a', 65) +
    '","type":"request","method":"service.status","payload":{}}'),
    ErrorCode) and (ErrorCode = 'request_id'), 'id-over-64',
    'a 65-character request id was accepted');
  Check(not Parse(TEncoding.UTF8.GetBytes(
    '{"v":1,"id":"\u0000","type":"request","method":"service.status","payload":{}}'),
    ErrorCode), 'control-char-id',
    'a request id containing a NUL control character was accepted');
  Check(not IsAllowedMethod('Service.Status'), 'case-variant-method',
    'method allowlist is case-insensitive and permits protocol aliases');
  Check(not IsAllowedMethod('shell.exec'), 'unknown-method',
    'a method outside the frozen allowlist was accepted');
end;

begin
  Failures := 0;
  TestMessageBounds;
  TestEnvelopeShape;
  TestInvalidUtf8;
  TestIdentifiersAndAllowlist;
  if Failures = 0 then
  begin
    Writeln('AdversarialProtocolTests: PASS');
    Halt(0);
  end;
  Writeln(ErrOutput, 'AdversarialProtocolTests: FAIL (', Failures,
    ' adversarial checks failed)');
  Halt(1);
end.
