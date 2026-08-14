unit RemoteSystem.Protocol;

interface

uses
  System.JSON,
  System.SysUtils;

const
  REMOTE_PROTOCOL_VERSION = 1;
  REMOTE_MAX_MESSAGE_BYTES = 64 * 1024;
  REMOTE_PIPE_NAME = '\\.\pipe\Galaxie.Remote.System.v1';

type
  TRemoteEnvelope = record
    Version: Integer;
    Id: string;
    MessageType: string;
    Method: string;
    Payload: TJSONObject;
  end;

function ParseRequest(const Raw: TBytes; out Envelope: TRemoteEnvelope;
  out ErrorCode, ErrorMessage: string): Boolean;
procedure FreeEnvelope(var Envelope: TRemoteEnvelope);
function IsAllowedMethod(const Method: string): Boolean;
function BuildResult(const Id: string; ResultValue: TJSONValue): TBytes;
function BuildError(const Id, Code, MessageText: string;
  Retryable: Boolean): TBytes;
function BuildEvent(const EventName: string; Payload: TJSONValue): TBytes;
function JsonObjectOrEmpty(Value: TJSONValue): TJSONObject;

implementation

function JsonBytes(Value: TJSONValue): TBytes;
begin
  try
    Result := TEncoding.UTF8.GetBytes(Value.ToJSON);
  finally
    Value.Free;
  end;
end;

function ContainsControlCharacter(const Value: string): Boolean;
var
  Ch: Char;
begin
  for Ch in Value do
    if (Ord(Ch) < $20) or ((Ord(Ch) >= $7F) and (Ord(Ch) <= $9F)) then
      Exit(True);
  Result := False;
end;

function JsonObjectOrEmpty(Value: TJSONValue): TJSONObject;
begin
  if Value is TJSONObject then
    Exit(TJSONObject(Value));
  Value.Free;
  Result := TJSONObject.Create;
end;

function ParseRequest(const Raw: TBytes; out Envelope: TRemoteEnvelope;
  out ErrorCode, ErrorMessage: string): Boolean;
var
  Root: TJSONValue;
  Obj: TJSONObject;
  PayloadValue, PayloadCopy: TJSONValue;
  JsonText: string;
begin
  Result := False;
  Envelope := Default(TRemoteEnvelope);
  ErrorCode := '';
  ErrorMessage := '';

  if (Length(Raw) = 0) or (Length(Raw) > REMOTE_MAX_MESSAGE_BYTES) then
  begin
    ErrorCode := 'message_size';
    ErrorMessage := 'Message must contain 1..65536 UTF-8 bytes';
    Exit;
  end;

  try
    JsonText := TEncoding.UTF8.GetString(Raw);
  except
    on E: EEncodingError do
    begin
      ErrorCode := 'invalid_utf8';
      ErrorMessage := 'Message is not valid UTF-8';
      Exit;
    end;
  end;

  try
    Root := TJSONObject.ParseJSONValue(JsonText, False, True);
  except
    on E: Exception do
    begin
      ErrorCode := 'invalid_json';
      ErrorMessage := 'Message is not valid JSON';
      Exit;
    end;
  end;
  if not (Root is TJSONObject) then
  begin
    Root.Free;
    ErrorCode := 'invalid_json';
    ErrorMessage := 'Expected a JSON object';
    Exit;
  end;

  Obj := TJSONObject(Root);
  try
    if not Obj.TryGetValue<Integer>('v', Envelope.Version) or
       (Envelope.Version <> REMOTE_PROTOCOL_VERSION) then
    begin
      ErrorCode := 'protocol_version';
      ErrorMessage := 'Unsupported protocol version';
      Exit;
    end;

    if not Obj.TryGetValue<string>('id', Envelope.Id) or
       (Envelope.Id = '') or (Length(Envelope.Id) > 64) or
       ContainsControlCharacter(Envelope.Id) then
    begin
      ErrorCode := 'request_id';
      ErrorMessage :=
        'Request id is required, must be at most 64 characters and contain no controls';
      Exit;
    end;

    if not Obj.TryGetValue<string>('type', Envelope.MessageType) or
       (Envelope.MessageType <> 'request') then
    begin
      ErrorCode := 'message_type';
      ErrorMessage := 'Only request envelopes are accepted';
      Exit;
    end;

    if not Obj.TryGetValue<string>('method', Envelope.Method) or
       (Envelope.Method = '') then
    begin
      ErrorCode := 'method';
      ErrorMessage := 'Method is required';
      Exit;
    end;

    PayloadValue := Obj.GetValue('payload');
    if PayloadValue <> nil then
    begin
      if not (PayloadValue is TJSONObject) then
      begin
        ErrorCode := 'invalid_payload';
        ErrorMessage := 'Payload must be a JSON object';
        Exit;
      end;
      PayloadCopy := TJSONObject.ParseJSONValue(PayloadValue.ToJSON, False, True);
      Envelope.Payload := JsonObjectOrEmpty(PayloadCopy);
    end
    else
      Envelope.Payload := TJSONObject.Create;
    Result := True;
  finally
    Obj.Free;
  end;
end;

procedure FreeEnvelope(var Envelope: TRemoteEnvelope);
begin
  FreeAndNil(Envelope.Payload);
end;

function IsAllowedMethod(const Method: string): Boolean;
begin
  Result := (Method = 'service.status') or
    (Method = 'agent.ensure') or
    (Method = 'agent.stop') or
    (Method = 'desktop.setMode');
end;

function BuildResult(const Id: string; ResultValue: TJSONValue): TBytes;
var
  Root: TJSONObject;
begin
  Root := TJSONObject.Create;
  Root.AddPair('v', TJSONNumber.Create(REMOTE_PROTOCOL_VERSION));
  Root.AddPair('id', Id);
  Root.AddPair('type', 'response');
  Root.AddPair('ok', TJSONBool.Create(True));
  Root.AddPair('result', ResultValue);
  Result := JsonBytes(Root);
end;

function BuildError(const Id, Code, MessageText: string;
  Retryable: Boolean): TBytes;
var
  Root, ErrorObj: TJSONObject;
begin
  Root := TJSONObject.Create;
  ErrorObj := TJSONObject.Create;
  ErrorObj.AddPair('code', Code);
  ErrorObj.AddPair('message', MessageText);
  ErrorObj.AddPair('retryable', TJSONBool.Create(Retryable));
  Root.AddPair('v', TJSONNumber.Create(REMOTE_PROTOCOL_VERSION));
  if Id <> '' then
    Root.AddPair('id', Id);
  Root.AddPair('type', 'response');
  Root.AddPair('ok', TJSONBool.Create(False));
  Root.AddPair('error', ErrorObj);
  Result := JsonBytes(Root);
end;

function BuildEvent(const EventName: string; Payload: TJSONValue): TBytes;
var
  Root: TJSONObject;
begin
  Root := TJSONObject.Create;
  Root.AddPair('v', TJSONNumber.Create(REMOTE_PROTOCOL_VERSION));
  Root.AddPair('type', 'event');
  Root.AddPair('event', EventName);
  Root.AddPair('payload', Payload);
  Result := JsonBytes(Root);
end;

end.
