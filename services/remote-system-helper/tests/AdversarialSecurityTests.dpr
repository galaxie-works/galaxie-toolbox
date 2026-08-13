program AdversarialSecurityTests;

{$APPTYPE CONSOLE}

uses
  System.SysUtils,
  Winapi.Windows,
  RemoteSystem.Security in '..\src\RemoteSystem.Security.pas';

const
  SDDL_REVISION_1 = 1;
  DACL_SECURITY_INFORMATION = $00000004;

function ConvertSecurityDescriptorToStringSecurityDescriptorW(
  SecurityDescriptor: Pointer; RequestedStringSDRevision,
  SecurityInformation: Cardinal; out StringSecurityDescriptor: PWideChar;
  StringSecurityDescriptorLen: PCardinal): BOOL; stdcall;
  external advapi32 name 'ConvertSecurityDescriptorToStringSecurityDescriptorW';

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

function DescriptorSddl(Descriptor: Pointer): string;
var
  Text: PWideChar;
begin
  Text := nil;
  if not ConvertSecurityDescriptorToStringSecurityDescriptorW(Descriptor,
    SDDL_REVISION_1, DACL_SECURITY_INFORMATION, Text, nil) then
    RaiseLastOSError;
  try
    Result := Text;
  finally
    LocalFree(HLOCAL(Text));
  end;
end;

procedure TestFallbackDacl;
var
  Attributes: TSecurityAttributes;
  Descriptor: Pointer;
  ErrorText, Sddl: string;
begin
  Descriptor := nil;
  Check(BuildPipeSecurity(Cardinal($FFFFFFFF), Attributes, Descriptor,
    ErrorText), 'fallback-dacl-build', ErrorText);
  if Descriptor = nil then
    Exit;
  try
    Sddl := DescriptorSddl(Descriptor);
    Check(Sddl.Contains('(D;;GA;;;NU)', True), 'deny-network', Sddl);
    Check(Sddl.Contains('(A;;GA;;;SY)', True), 'allow-system', Sddl);
    Check(Sddl.Contains('(A;;GA;;;BA)', True), 'allow-admins', Sddl);
    Check(not Sddl.Contains(';;;WD)', True), 'no-everyone', Sddl);
    Check(not Sddl.Contains(';;;AU)', True), 'no-authenticated-users', Sddl);
    Check(Attributes.bInheritHandle = False, 'non-inheritable-handle',
      'pipe security attributes allow handle inheritance');
  finally
    FreePipeSecurity(Descriptor);
  end;
end;

procedure TestMissingAndUnsignedBinaries;
var
  ErrorText, MissingPath: string;
begin
  MissingPath := IncludeTrailingPathDelimiter(GetEnvironmentVariable('TEMP')) +
    'galaxie-qa-definitely-missing.exe';
  Check(not ValidateInstalledBinary(MissingPath, ErrorText),
    'missing-binary-rejected', 'missing binary was trusted');
  Check(ErrorText.StartsWith('Installed binary is missing:', True),
    'missing-binary-reason', ErrorText);
  Check(not ValidateInstalledBinary(ParamStr(0), ErrorText),
    'unsigned-binary-rejected', 'unsigned QA binary was trusted');
  Check(ErrorText <> '', 'unsigned-binary-reason',
    'signature rejection did not return an error');
end;

begin
  Failures := 0;
  TestFallbackDacl;
  TestMissingAndUnsignedBinaries;
  if Failures = 0 then
  begin
    Writeln('AdversarialSecurityTests: PASS');
    Halt(0);
  end;
  Writeln(ErrOutput, 'AdversarialSecurityTests: FAIL (', Failures,
    ' checks failed)');
  Halt(1);
end.
