unit RemoteSystem.Security;

interface

uses
  System.SysUtils,
  Winapi.Windows;

const
  REMOTE_EXPECTED_PUBLISHER = 'Galaxie Works';

function BuildPipeSecurity(SessionId: Cardinal; out Attributes: TSecurityAttributes;
  out Descriptor: Pointer; out ErrorText: string): Boolean;
procedure FreePipeSecurity(Descriptor: Pointer);
function ValidatePipeClient(Pipe: THandle; ClaimedPid, ClaimedSession: Cardinal;
  const InstallDirectory: string; out ErrorText: string): Boolean;
function ValidateInstalledBinary(const FileName: string;
  out ErrorText: string): Boolean;

implementation

uses
  System.IOUtils,
  Winapi.WtsApi32;

const
  SDDL_REVISION_1 = 1;
  CERT_NAME_SIMPLE_DISPLAY_TYPE = 4;
  PROCESS_QUERY_LIMITED_INFORMATION = $1000;

type
  PCryptProviderCert = ^TCryptProviderCert;
  TCryptProviderCert = record
    cbStruct: Cardinal;
    pCert: PCCERT_CONTEXT;
    fCommercial: BOOL;
    fTrustedRoot: BOOL;
    fSelfSigned: BOOL;
    fTestCert: BOOL;
    dwRevokedReason: Cardinal;
    dwConfidence: Cardinal;
    dwError: Cardinal;
    pTrustListContext: Pointer;
    fTrustListSignerCert: BOOL;
    pCtlContext: Pointer;
    dwCtlError: Cardinal;
    fIsCyclic: BOOL;
    pChainElement: Pointer;
  end;

  PCryptProviderSigner = ^TCryptProviderSigner;
  TCryptProviderSigner = record
    cbStruct: Cardinal;
    sftVerifyAsOf: TFileTime;
    csCertChain: Cardinal;
    pasCertChain: PCryptProviderCert;
  end;

function ConvertStringSecurityDescriptorToSecurityDescriptorW(
  StringSecurityDescriptor: PWideChar; StringSDRevision: Cardinal;
  out SecurityDescriptor: Pointer; SecurityDescriptorSize: PCardinal): BOOL;
  stdcall; external advapi32 name
  'ConvertStringSecurityDescriptorToSecurityDescriptorW';
function QueryFullProcessImageNameW(Process: THandle; Flags: Cardinal;
  ExeName: PWideChar; var Size: Cardinal): BOOL; stdcall;
  external kernel32 name 'QueryFullProcessImageNameW';
function WTHelperProvDataFromStateData(StateData: THandle): Pointer; stdcall;
  external wintrust name 'WTHelperProvDataFromStateData';
function WTHelperGetProvSignerFromChain(ProviderData: Pointer;
  SignerIndex: Cardinal; CounterSigner: BOOL; CounterSignerIndex: Cardinal):
  PCryptProviderSigner; stdcall;
  external wintrust name 'WTHelperGetProvSignerFromChain';
function CertGetNameStringW(CertContext: PCCERT_CONTEXT; NameType, Flags: Cardinal;
  TypeParameter: Pointer; NameString: PWideChar; NameSize: Cardinal): Cardinal;
  stdcall; external 'crypt32.dll' name 'CertGetNameStringW';

function LogonSidForSession(SessionId: Cardinal; out SidText: string): Boolean;
var
  Token: THandle;
  Needed, I: Cardinal;
  Buffer: TBytes;
  Groups: PTokenGroups;
  StringSid: PWideChar;
begin
  Result := False;
  SidText := '';
  Token := 0;
  if not WTSQueryUserToken(SessionId, Token) then
    Exit;
  try
    Needed := 0;
    GetTokenInformation(Token, TokenGroups, nil, 0, Needed);
    if (Needed = 0) or (GetLastError <> ERROR_INSUFFICIENT_BUFFER) then
      Exit;
    SetLength(Buffer, Needed);
    if not GetTokenInformation(Token, TokenGroups, @Buffer[0], Needed, Needed) then
      Exit;
    Groups := PTokenGroups(@Buffer[0]);
    for I := 0 to Groups.GroupCount - 1 do
      if (Groups.Groups[I].Attributes and SE_GROUP_LOGON_ID) = SE_GROUP_LOGON_ID then
      begin
        StringSid := nil;
        if ConvertSidToStringSidW(Groups.Groups[I].Sid, StringSid) then
        try
          SidText := StringSid;
          Result := True;
        finally
          LocalFree(HLOCAL(StringSid));
        end;
        Exit;
      end;
  finally
    CloseHandle(Token);
  end;
end;

function BuildPipeSecurity(SessionId: Cardinal; out Attributes: TSecurityAttributes;
  out Descriptor: Pointer; out ErrorText: string): Boolean;
var
  SidText, Sddl: string;
begin
  ZeroMemory(@Attributes, SizeOf(Attributes));
  Descriptor := nil;
  ErrorText := '';

  if LogonSidForSession(SessionId, SidText) then
    Sddl := Format('D:P(D;;GA;;;NU)(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;%s)',
      [SidText])
  else
    Sddl := 'D:P(D;;GA;;;NU)(A;;GA;;;SY)(A;;GA;;;BA)';

  if not ConvertStringSecurityDescriptorToSecurityDescriptorW(PWideChar(Sddl),
    SDDL_REVISION_1, Descriptor, nil) then
  begin
    ErrorText := 'Security descriptor: ' + SysErrorMessage(GetLastError);
    Exit(False);
  end;

  Attributes.nLength := SizeOf(Attributes);
  Attributes.lpSecurityDescriptor := Descriptor;
  Attributes.bInheritHandle := False;
  Result := True;
end;

procedure FreePipeSecurity(Descriptor: Pointer);
begin
  if Descriptor <> nil then
    LocalFree(HLOCAL(Descriptor));
end;

function ProcessImagePath(Pid: Cardinal; out ImagePath: string): Boolean;
var
  ProcessHandle: THandle;
  Buffer: array[0..32767] of WideChar;
  BufferLength: Cardinal;
begin
  Result := False;
  ImagePath := '';
  ProcessHandle := OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, Pid);
  if ProcessHandle = 0 then
    Exit;
  try
    BufferLength := Length(Buffer);
    if QueryFullProcessImageNameW(ProcessHandle, 0, @Buffer[0], BufferLength) then
    begin
      SetString(ImagePath, PWideChar(@Buffer[0]), BufferLength);
      ImagePath := TPath.GetFullPath(ImagePath);
      Result := True;
    end;
  finally
    CloseHandle(ProcessHandle);
  end;
end;

function PathIsInside(const ChildPath, ParentPath: string): Boolean;
var
  Child, Parent: string;
begin
  Child := IncludeTrailingPathDelimiter(TPath.GetDirectoryName(
    TPath.GetFullPath(ChildPath)));
  Parent := IncludeTrailingPathDelimiter(TPath.GetFullPath(ParentPath));
  Result := Child.StartsWith(Parent, True);
end;

function VerifyAuthenticodePublisher(const FileName, ExpectedPublisher: string;
  out ErrorText: string): Boolean;
var
  FileInfo: TWinTrustFileInfo;
  TrustData: TWinTrustData;
  Action: TGUID;
  Status: Longint;
  ProviderData: Pointer;
  Signer: PCryptProviderSigner;
  NameLength: Cardinal;
  Publisher: string;
begin
  Result := False;
  ErrorText := '';
  ZeroMemory(@FileInfo, SizeOf(FileInfo));
  FileInfo.cbStruct := SizeOf(FileInfo);
  FileInfo.pcwszFilePath := PWideChar(FileName);

  ZeroMemory(@TrustData, SizeOf(TrustData));
  TrustData.cbStruct := SizeOf(TrustData);
  TrustData.dwUIChoice := WTD_UI_NONE;
  TrustData.fdwRevocationChecks := WTD_REVOKE_WHOLECHAIN;
  TrustData.dwUnionChoice := WTD_CHOICE_FILE;
  TrustData.pFile := @FileInfo;
  TrustData.dwStateAction := WTD_STATEACTION_VERIFY;
  TrustData.dwProvFlags := WTD_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT;
  Action := WINTRUST_ACTION_GENERIC_VERIFY_V2;

  Status := WinVerifyTrust(INVALID_HANDLE_VALUE, Action, @TrustData);
  try
    if Status <> ERROR_SUCCESS then
    begin
      ErrorText := Format('Authenticode trust failed: 0x%.8x', [Cardinal(Status)]);
      Exit;
    end;

    ProviderData := WTHelperProvDataFromStateData(TrustData.hWVTStateData);
    if ProviderData = nil then
    begin
      ErrorText := 'Authenticode provider data unavailable';
      Exit;
    end;
    Signer := WTHelperGetProvSignerFromChain(ProviderData, 0, False, 0);
    if (Signer = nil) or (Signer.csCertChain = 0) or
       (Signer.pasCertChain = nil) or (Signer.pasCertChain.pCert = nil) then
    begin
      ErrorText := 'Authenticode signer unavailable';
      Exit;
    end;

    NameLength := CertGetNameStringW(Signer.pasCertChain.pCert,
      CERT_NAME_SIMPLE_DISPLAY_TYPE, 0, nil, nil, 0);
    if NameLength <= 1 then
    begin
      ErrorText := 'Authenticode publisher unavailable';
      Exit;
    end;
    SetLength(Publisher, NameLength - 1);
    CertGetNameStringW(Signer.pasCertChain.pCert,
      CERT_NAME_SIMPLE_DISPLAY_TYPE, 0, nil, PWideChar(Publisher), NameLength);
    if not Publisher.Contains(ExpectedPublisher, True) then
    begin
      ErrorText := 'Unexpected Authenticode publisher: ' + Publisher;
      Exit;
    end;
    Result := True;
  finally
    TrustData.dwStateAction := WTD_STATEACTION_CLOSE;
    WinVerifyTrust(INVALID_HANDLE_VALUE, Action, @TrustData);
  end;
end;

function ValidatePipeClient(Pipe: THandle; ClaimedPid, ClaimedSession: Cardinal;
  const InstallDirectory: string; out ErrorText: string): Boolean;
var
  ActualPid, ActualSession: Cardinal;
  ImagePath: string;
begin
  Result := False;
  ErrorText := '';
  if not ImpersonateNamedPipeClient(Pipe) then
  begin
    ErrorText := 'ImpersonateNamedPipeClient: ' + SysErrorMessage(GetLastError);
    Exit;
  end;
  RevertToSelf;
  ActualPid := 0;
  if not GetNamedPipeClientProcessId(Pipe, ActualPid) then
  begin
    ErrorText := 'GetNamedPipeClientProcessId: ' + SysErrorMessage(GetLastError);
    Exit;
  end;
  if (ClaimedPid = 0) or (ActualPid <> ClaimedPid) then
  begin
    ErrorText := 'Pipe client PID mismatch';
    Exit;
  end;
  if not ProcessIdToSessionId(ActualPid, ActualSession) or
     (ActualSession <> ClaimedSession) then
  begin
    ErrorText := 'Pipe client session mismatch';
    Exit;
  end;
  if not ProcessImagePath(ActualPid, ImagePath) then
  begin
    ErrorText := 'Unable to resolve pipe client image';
    Exit;
  end;
  if not PathIsInside(ImagePath, InstallDirectory) then
  begin
    ErrorText := 'Pipe client is outside the protected installation directory';
    Exit;
  end;
  if not VerifyAuthenticodePublisher(ImagePath, REMOTE_EXPECTED_PUBLISHER,
    ErrorText) then
    Exit;
  Result := True;
end;

function ValidateInstalledBinary(const FileName: string;
  out ErrorText: string): Boolean;
begin
  if not FileExists(FileName) then
  begin
    ErrorText := 'Installed binary is missing: ' + FileName;
    Exit(False);
  end;
  Result := VerifyAuthenticodePublisher(FileName, REMOTE_EXPECTED_PUBLISHER,
    ErrorText);
end;

end.
