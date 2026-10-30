; Instalador do Conector Kontar (Inno Setup 6). Gerado por instalador\build.ps1 — não compile direto.
; Defines vindos do build: Versao, AppDir (pasta do conector pronta), NodeExe, PreZip, Saida.
;
; Instalação silenciosa (sem telas), ex.:
;   KontarConectorSetup.exe /VERYSILENT /TOKEN=xxx /SERVIDOR=127.0.0.1 /USUARIO=u /SENHA=s /LOJAS=1,2
;   opcionais: /PORTA=3306 /BANCO=central /DESDE=781 /ENDERECOS=1-10
; Em atualização silenciosa sem /TOKEN a configuração atual é mantida.

#define Nome "Kontar Conector"

[Setup]
AppId={{6F1E2C7A-4B3D-4E59-9A0B-8C2D1F7E3A41}
AppName={#Nome}
AppVersion={#Versao}
AppVerName={#Nome} {#Versao}
AppPublisher=Kontar
AppPublisherURL=https://kontarapp.github.io/kontar/
AppSupportURL=https://kontarapp.github.io/kontar/
VersionInfoVersion={#Versao}
VersionInfoCompany=Kontar
VersionInfoDescription=Instalador do Conector Kontar
#ifdef TESTE
DefaultDirName={localappdata}\KontarConectorTeste
#else
DefaultDirName={autopf}\{#Nome}
#endif
DisableDirPage=yes
DisableWelcomePage=no
DisableProgramGroupPage=yes
DisableReadyPage=no
UsePreviousAppDir=yes
#ifdef TESTE
PrivilegesRequired=lowest
#else
PrivilegesRequired=admin
#endif
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#Saida}
OutputBaseFilename=KontarConectorSetup
SetupIconFile=kontar.ico
UninstallDisplayIcon={app}\kontar.ico
UninstallDisplayName={#Nome}
WizardStyle=modern
WizardSmallImageFile=pequena-58.bmp,pequena-116.bmp
WizardImageFile=lateral-164.bmp,lateral-246.bmp,lateral-328.bmp
Compression=lzma2/max
SolidCompression=yes
CloseApplications=no
SetupLogging=yes

[Languages]
Name: "pt"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Messages]
pt.WelcomeLabel1=Instalar o Conector Kontar
pt.WelcomeLabel2=O conector liga o ERP ao Kontar neste servidor:%n%n•  inventário aberto no ERP aparece no Kontar com o catálogo da loja;%n•  quando o balanço é encerrado no Kontar, a contagem volta para o ERP.%n%nTenha em mãos o token de integração do Kontar e o acesso ao banco de dados do ERP.
pt.FinishedHeadingLabel=Conector instalado
pt.FinishedLabelNoIcons=O Conector Kontar foi instalado e já está rodando.%n%nEle liga junto com o servidor e verifica o ERP a cada minuto. Os inventários abertos no ERP a partir de agora vão aparecer no Kontar.
pt.FinishedLabel=O Conector Kontar foi instalado e já está rodando.%n%nEle liga junto com o servidor e verifica o ERP a cada minuto. Os inventários abertos no ERP a partir de agora vão aparecer no Kontar.

[Files]
Source: "{#AppDir}\*"; DestDir: "{app}\app"; Flags: recursesubdirs ignoreversion createallsubdirs
Source: "{#NodeExe}"; DestDir: "{app}\node"; Flags: ignoreversion
Source: "kontar.ico"; DestDir: "{app}"; Flags: ignoreversion
; usados só durante o assistente (teste de conexão antes de instalar)
Source: "{#NodeExe}"; Flags: dontcopy
Source: "{#PreZip}"; DestName: "pre.zip"; Flags: dontcopy

[Run]
Filename: "{commonappdata}\{#Nome}\logs"; Description: "Abrir a pasta de registros (logs)"; Flags: postinstall shellexec skipifsilent unchecked skipifdoesntexist

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\app\tarefa.ps1"" -Acao Remover"; Flags: runhidden waituntilterminated; RunOnceId: "RemoverTarefa"

[UninstallDelete]
Type: filesandordirs; Name: "{commonappdata}\{#Nome}"
Type: filesandordirs; Name: "{app}"

[Code]
const
  URL_PADRAO = 'https://southamerica-east1-kontar-e2650.cloudfunctions.net/api/v1';

var
  PagToken, PagBanco: TInputQueryWizardPage;
  PagLojas: TWizardPage;
  ListaLojas: TNewCheckListBox;
  LojasNum: TStringList;
  ChkAvBanco, ChkAvLojas: TNewCheckBox;
  LbPorta, LbBanco, LbEnd, LbDesde, LbDesdeDica, LbCliente, LbLojasVazio: TNewStaticText;
  EdPorta, EdBanco, EdEnd, EdDesde: TNewEdit;
  CfgAnt: String;
  NomeCliente: String;
  MaiorInv: Integer;
  PreExtraido: Boolean;

// ---------- utilidades ----------

function PastaCfg(): String;
begin
#ifdef TESTE
  Result := ExpandConstant('{localappdata}\KontarConectorTeste\cfg');
#else
  Result := ExpandConstant('{commonappdata}\{#Nome}');
#endif
end;

function ArqCfg(): String;
begin
  Result := PastaCfg() + '\conector.json';
end;

function JsonEsc(S: String): String;
begin
  StringChangeEx(S, '\', '\\', True);
  StringChangeEx(S, '"', '\"', True);
  Result := S;
end;

// Lê "chave": valor da configuração anterior (formato gravado por este instalador: uma chave por linha).
function ValorAnt(Chave: String): String;
var P, Q: Integer; Resto: String;
begin
  Result := '';
  P := Pos('"' + Chave + '":', CfgAnt);
  if P = 0 then Exit;
  Resto := Copy(CfgAnt, P + Length(Chave) + 3, 2000);
  Q := Pos(#10, Resto);
  if Q > 0 then Resto := Copy(Resto, 1, Q - 1);
  Resto := Trim(Resto);
  if (Length(Resto) > 0) and (Resto[Length(Resto)] = ',') then Resto := Copy(Resto, 1, Length(Resto) - 1);
  Resto := Trim(Resto);
  if (Length(Resto) >= 2) and (Resto[1] = '"') then begin
    Resto := Copy(Resto, 2, Length(Resto) - 2);
    StringChangeEx(Resto, '\"', '"', True);
    StringChangeEx(Resto, '\\', '\', True);
  end;
  if (Length(Resto) >= 2) and (Resto[1] = '[') then Resto := Copy(Resto, 2, Length(Resto) - 2);
  Result := Resto;
end;

// Valor inicial: parâmetro de linha de comando > configuração anterior > padrão.
function Inicial(Param, Chave, Padrao: String): String;
begin
  Result := ExpandConstant('{param:' + Param + '|}');
  if Result = '' then Result := ValorAnt(Chave);
  if Result = '' then Result := Padrao;
end;

function SoDigitos(S: String): Boolean;
var I: Integer;
begin
  Result := Length(S) > 0;
  for I := 1 to Length(S) do
    if (S[I] < '0') or (S[I] > '9') then begin Result := False; Exit; end;
end;

function UrlApi(): String;
begin
  Result := Inicial('URL', 'url', URL_PADRAO);
end;

// Lojas marcadas, separadas por vírgula.
function LojasMarcadas(): String;
var I: Integer;
begin
  Result := '';
  for I := 0 to ListaLojas.Items.Count - 1 do
    if ListaLojas.Checked[I] then begin
      if Result <> '' then Result := Result + ', ';
      Result := Result + LojasNum[I];
    end;
end;

function MontarCfg(Token, Host, Porta, Usuario, Senha, Banco, Lojas, Desde, Enderecos: String): TArrayOfString;
begin
  SetArrayLength(Result, 22);
  Result[0] := '{';
  Result[1] := '  "kontar": {';
  Result[2] := '    "url": "' + JsonEsc(UrlApi()) + '",';
  Result[3] := '    "token": "' + JsonEsc(Token) + '"';
  Result[4] := '  },';
  Result[5] := '  "erp": "dlinks",';
  Result[6] := '  "mysql": {';
  Result[7] := '    "host": "' + JsonEsc(Host) + '",';
  Result[8] := '    "port": ' + Porta + ',';
  Result[9] := '    "user": "' + JsonEsc(Usuario) + '",';
  Result[10] := '    "password": "' + JsonEsc(Senha) + '",';
  Result[11] := '    "database": "' + JsonEsc(Banco) + '"';
  Result[12] := '  },';
  Result[13] := '  "lojas": [' + Lojas + '],';
  Result[14] := '  "dlinks": {';
  Result[15] := '    "statusFechados": [2, 3],';
  Result[16] := '    "desdeNIven": ' + Desde;
  Result[17] := '  },';
  Result[18] := '  "enderecosPadrao": "' + JsonEsc(Enderecos) + '",';
  Result[19] := '  "porEndereco": true,';
  Result[20] := '  "app": 0, "intervaloSeg": 60';
  Result[21] := '}';
end;

function RodarOculto(Exe, Params: String; var Codigo: Integer): Boolean;
begin
  Result := Exec(Exe, Params, '', SW_HIDE, ewWaitUntilTerminated, Codigo);
end;

function PowerShell(): String;
begin
  Result := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
end;

// ---------- telas ----------

procedure AvBancoClick(Sender: TObject);
begin
  LbPorta.Visible := ChkAvBanco.Checked; EdPorta.Visible := ChkAvBanco.Checked;
  LbBanco.Visible := ChkAvBanco.Checked; EdBanco.Visible := ChkAvBanco.Checked;
end;

procedure AvLojasClick(Sender: TObject);
begin
  LbEnd.Visible := ChkAvLojas.Checked; EdEnd.Visible := ChkAvLojas.Checked;
  LbDesde.Visible := ChkAvLojas.Checked; EdDesde.Visible := ChkAvLojas.Checked; LbDesdeDica.Visible := ChkAvLojas.Checked;
end;

function NovoRotulo(Pai: TWizardPage; Texto: String; Topo: Integer): TNewStaticText;
begin
  Result := TNewStaticText.Create(Pai);
  Result.Parent := Pai.Surface;
  Result.Caption := Texto;
  Result.Top := Topo;
  Result.Left := 0;
end;

function NovoCampo(Pai: TWizardPage; Topo, Largura: Integer; Texto: String): TNewEdit;
begin
  Result := TNewEdit.Create(Pai);
  Result.Parent := Pai.Surface;
  Result.Top := Topo;
  Result.Left := 0;
  Result.Width := Largura;
  Result.Text := Texto;
end;

function InitializeSetup(): Boolean;
var Linhas: TArrayOfString; I: Integer;
begin
  CfgAnt := '';
  if FileExists(ArqCfg()) and LoadStringsFromFile(ArqCfg(), Linhas) then
    for I := 0 to GetArrayLength(Linhas) - 1 do CfgAnt := CfgAnt + Linhas[I] + #10;
  LojasNum := TStringList.Create;
  MaiorInv := -1;
  Result := True;
end;

procedure InitializeWizard();
var Y: Integer; DesdeIni: String;
begin
  // 1. Token
  PagToken := CreateInputQueryPage(wpWelcome, 'Conexão com o Kontar', 'Cole o token de integração do Kontar.',
    'No app Kontar, abra o menu Integrações, toque em "Gerar novo token" e depois em "Copiar token". Cole o token abaixo.');
  PagToken.Add('Token:', False);
  PagToken.Values[0] := Inicial('TOKEN', 'token', '');

  // 2. Banco do ERP
  PagBanco := CreateInputQueryPage(PagToken.ID, 'Banco de dados do ERP', 'Onde está o banco de dados do ERP?',
    'Informe o servidor e o acesso ao MySQL do ERP. Na maioria dos casos o banco fica neste mesmo servidor (127.0.0.1). Ao avançar, a conexão será testada.');
  PagBanco.Add('Servidor (IP ou nome):', False);
  PagBanco.Add('Usuário:', False);
  PagBanco.Add('Senha:', True);
  PagBanco.Values[0] := Inicial('SERVIDOR', 'host', '127.0.0.1');
  PagBanco.Values[1] := Inicial('USUARIO', 'user', '');
  PagBanco.Values[2] := Inicial('SENHA', 'password', '');

  Y := PagBanco.Edits[2].Top + PagBanco.Edits[2].Height + ScaleY(14);
  ChkAvBanco := TNewCheckBox.Create(PagBanco);
  ChkAvBanco.Parent := PagBanco.Surface;
  ChkAvBanco.Caption := 'Opções avançadas';
  ChkAvBanco.Top := Y; ChkAvBanco.Left := 0; ChkAvBanco.Width := ScaleX(200);
  ChkAvBanco.OnClick := @AvBancoClick;
  Y := Y + ScaleY(24);
  LbPorta := NovoRotulo(PagBanco, 'Porta:', Y + ScaleY(3));
  EdPorta := NovoCampo(PagBanco, Y, ScaleX(70), Inicial('PORTA', 'port', '3306'));
  EdPorta.Left := ScaleX(60);
  LbBanco := NovoRotulo(PagBanco, 'Banco:', Y + ScaleY(3));
  LbBanco.Left := ScaleX(150);
  EdBanco := NovoCampo(PagBanco, Y, ScaleX(140), Inicial('BANCO', 'database', 'central'));
  EdBanco.Left := ScaleX(200);
  ChkAvBanco.Checked := (EdPorta.Text <> '3306') or (EdBanco.Text <> 'central');
  AvBancoClick(nil);

  // 3. Lojas
  PagLojas := CreateCustomPage(PagBanco.ID, 'Lojas', 'Quais lojas este servidor atende?');
  LbCliente := NovoRotulo(PagLojas, '', 0);
  LbCliente.Width := PagLojas.SurfaceWidth;
  LbCliente.WordWrap := True;
  ListaLojas := TNewCheckListBox.Create(PagLojas);
  ListaLojas.Parent := PagLojas.Surface;
  ListaLojas.Top := ScaleY(40);
  ListaLojas.Left := 0;
  ListaLojas.Width := PagLojas.SurfaceWidth;
  ListaLojas.Height := ScaleY(150);
  LbLojasVazio := NovoRotulo(PagLojas, '', ScaleY(44));

  Y := ListaLojas.Top + ListaLojas.Height + ScaleY(10);
  ChkAvLojas := TNewCheckBox.Create(PagLojas);
  ChkAvLojas.Parent := PagLojas.Surface;
  ChkAvLojas.Caption := 'Opções avançadas';
  ChkAvLojas.Top := Y; ChkAvLojas.Left := 0; ChkAvLojas.Width := ScaleX(200);
  ChkAvLojas.OnClick := @AvLojasClick;
  Y := Y + ScaleY(24);
  LbEnd := NovoRotulo(PagLojas, 'Endereços criados em cada balanço:', Y + ScaleY(3));
  EdEnd := NovoCampo(PagLojas, Y, ScaleX(140), Inicial('ENDERECOS', 'enderecosPadrao', '1-10'));
  EdEnd.Left := ScaleX(230);
  Y := Y + ScaleY(28);
  LbDesde := NovoRotulo(PagLojas, 'Levar inventários a partir do nº:', Y + ScaleY(3));
  DesdeIni := ExpandConstant('{param:DESDE|}');
  if DesdeIni = '' then DesdeIni := ValorAnt('desdeNIven');
  EdDesde := NovoCampo(PagLojas, Y, ScaleX(90), DesdeIni);
  EdDesde.Left := ScaleX(230);
  LbDesdeDica := NovoRotulo(PagLojas, 'Em branco: só os inventários abertos depois desta instalação.', Y + ScaleY(26));
  LbDesdeDica.Font.Color := clGray;
  ChkAvLojas.Checked := (EdEnd.Text <> '1-10');
  AvLojasClick(nil);
end;

// Extrai Node + conector pro {tmp} e roda --verificar. Preenche a lista de lojas.
function Verificar(): Boolean;
var
  Prog: TOutputMarqueeProgressWizardPage;
  Linhas, Cfg: TArrayOfString;
  I, Codigo, P1, P2: Integer;
  L, Num, Resto, Marcadas, Erro, Qtd: String;
begin
  Result := False;
  Erro := '';
  Prog := CreateOutputMarqueeProgressPage('Testando a conexão', 'Conferindo o token do Kontar e o banco de dados do ERP...');
  Prog.Show;
  try
    if not PreExtraido then begin
      ExtractTemporaryFile('node.exe');
      ExtractTemporaryFile('pre.zip');
      RodarOculto(PowerShell(), '-NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath ''' +
        ExpandConstant('{tmp}\pre.zip') + ''' -DestinationPath ''' + ExpandConstant('{tmp}\pre') + ''' -Force"', Codigo);
      PreExtraido := FileExists(ExpandConstant('{tmp}\pre\index.js'));
      if not PreExtraido then begin
        MsgBox('Não consegui preparar o teste de conexão (falha ao extrair arquivos).', mbError, MB_OK);
        Exit;
      end;
    end;
    Cfg := MontarCfg(Trim(PagToken.Values[0]), Trim(PagBanco.Values[0]), IntToStr(StrToIntDef(Trim(EdPorta.Text), 3306)),
      Trim(PagBanco.Values[1]), PagBanco.Values[2], Trim(EdBanco.Text), '', '0', '1-10');
    SaveStringsToUTF8File(ExpandConstant('{tmp}\verif.json'), Cfg, False);
    DeleteFile(ExpandConstant('{tmp}\verif.txt'));
    RodarOculto(ExpandConstant('{tmp}\node.exe'), '"' + ExpandConstant('{tmp}\pre\index.js') + '" --config "' + ExpandConstant('{tmp}\verif.json') +
      '" --verificar "' + ExpandConstant('{tmp}\verif.txt') + '"', Codigo);
    DeleteFile(ExpandConstant('{tmp}\verif.json'));
    if not LoadStringsFromFile(ExpandConstant('{tmp}\verif.txt'), Linhas) then SetArrayLength(Linhas, 0);

    Marcadas := ',' + ExpandConstant('{param:LOJAS|}') + ',';
    if Marcadas = ',,' then Marcadas := ',' + ValorAnt('lojas') + ',';
    StringChangeEx(Marcadas, ' ', '', True);
    ListaLojas.Items.Clear;
    LojasNum.Clear;
    NomeCliente := '';
    for I := 0 to GetArrayLength(Linhas) - 1 do begin
      L := Trim(Linhas[I]);
      if Copy(L, 1, 5) = 'ERRO|' then Erro := Copy(L, 6, 1000)
      else if Copy(L, 1, 3) = 'OK|' then NomeCliente := Copy(L, 4, 1000)
      else if Copy(L, 1, 6) = 'MAIOR|' then MaiorInv := StrToIntDef(Copy(L, 7, 20), 0)
      else if Copy(L, 1, 5) = 'LOJA|' then begin
        Resto := Copy(L, 6, 1000);
        P1 := Pos('|', Resto); Num := Copy(Resto, 1, P1 - 1); Resto := Copy(Resto, P1 + 1, 1000);
        P2 := Pos('|', Resto);
        LojasNum.Add(Num);
        Qtd := Copy(Resto, P2 + 1, 20);
        if Qtd = '1' then Qtd := '1 produto' else Qtd := Qtd + ' produtos';
        ListaLojas.AddCheckBox(Copy(Resto, 1, P2 - 1), Qtd, 0,
          Pos(',' + Num + ',', Marcadas) > 0, True, False, True, nil);
      end;
    end;
  finally
    Prog.Hide;
  end;

  if Erro <> '' then begin
    MsgBox(Erro, mbError, MB_OK);
    Exit;
  end;
  if NomeCliente = '' then begin
    L := '';
    for I := 0 to GetArrayLength(Linhas) - 1 do L := L + Linhas[I] + #13#10;
    MsgBox('Não consegui testar a conexão.' + #13#10#13#10 + Copy(L, 1, 600), mbError, MB_OK);
    Exit;
  end;
  LbCliente.Caption := 'Conectado ao Kontar: ' + NomeCliente + '. Marque as lojas que este servidor atende:';
  LbLojasVazio.Caption := '';
  if ListaLojas.Items.Count = 0 then LbLojasVazio.Caption := 'Nenhuma loja com estoque encontrada no banco do ERP.';
  if MaiorInv >= 0 then
    LbDesdeDica.Caption := 'Em branco: só os inventários abertos depois desta instalação (a partir do nº ' + IntToStr(MaiorInv + 1) + ').';
  Result := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = PagToken.ID then begin
    PagToken.Values[0] := Trim(PagToken.Values[0]);
    if Length(PagToken.Values[0]) < 20 then begin
      MsgBox('Cole o token de integração gerado no app Kontar (menu Integrações).', mbInformation, MB_OK);
      Result := False;
    end;
  end else if CurPageID = PagBanco.ID then begin
    if (Trim(PagBanco.Values[0]) = '') or (Trim(PagBanco.Values[1]) = '') then begin
      MsgBox('Informe o servidor e o usuário do banco de dados.', mbInformation, MB_OK);
      Result := False;
    end else if not SoDigitos(Trim(EdPorta.Text)) then begin
      MsgBox('A porta precisa ser um número (normalmente 3306).', mbInformation, MB_OK);
      ChkAvBanco.Checked := True; AvBancoClick(nil);
      Result := False;
    end else
      Result := Verificar();
  end else if CurPageID = PagLojas.ID then begin
    if LojasMarcadas() = '' then begin
      MsgBox('Marque ao menos uma loja.', mbInformation, MB_OK);
      Result := False;
    end else if (Trim(EdDesde.Text) <> '') and not SoDigitos(Trim(EdDesde.Text)) then begin
      MsgBox('"Levar inventários a partir do nº" precisa ser um número, ou ficar em branco.', mbInformation, MB_OK);
      Result := False;
    end else if Trim(EdEnd.Text) = '' then begin
      MsgBox('Informe os endereços criados em cada balanço (ex.: 1-10).', mbInformation, MB_OK);
      ChkAvLojas.Checked := True; AvLojasClick(nil);
      Result := False;
    end;
  end;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
var Desde: String;
begin
  Desde := Trim(EdDesde.Text);
  if Desde = '' then Desde := 'só os novos (a partir do nº ' + IntToStr(MaiorInv + 1) + ')';
  Result := 'Kontar:' + NewLine + Space + NomeCliente + NewLine + NewLine +
    'Banco do ERP:' + NewLine + Space + Trim(PagBanco.Values[0]) + ':' + Trim(EdPorta.Text) + '  (' + Trim(EdBanco.Text) + ', usuário ' + Trim(PagBanco.Values[1]) + ')' + NewLine + NewLine +
    'Lojas:' + NewLine + Space + LojasMarcadas() + NewLine + NewLine +
    'Inventários:' + NewLine + Space + Desde + NewLine + NewLine +
    'Pasta:' + NewLine + Space + ExpandConstant('{app}');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var Codigo: Integer;
begin
  // Atualização: para o conector que está rodando pra liberar os arquivos.
  RodarOculto(ExpandConstant('{sys}\schtasks.exe'), '/End /TN KontarConector', Codigo);
  RodarOculto(PowerShell(), '-NoProfile -ExecutionPolicy Bypass -Command "' +
    'Get-CimInstance Win32_Process -Filter ""Name=''node.exe''"" | Where-Object { $_.CommandLine -like ''*Kontar Conector*index.js*'' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"', Codigo);
  Result := '';
end;

procedure GravarConfiguracao();
var Cfg, Linhas: TArrayOfString; Token, Desde, Lojas: String; Codigo: Integer;
begin
  ForceDirectories(PastaCfg() + '\logs');
  if WizardSilent() then begin
    Token := ExpandConstant('{param:TOKEN|}');
    if (Token = '') and FileExists(ArqCfg()) then Exit;  // atualização silenciosa: mantém a configuração
    Lojas := ExpandConstant('{param:LOJAS|}');
    StringChangeEx(Lojas, ' ', '', True);
    StringChangeEx(Lojas, ',', ', ', True);
    Desde := ExpandConstant('{param:DESDE|}');
    Cfg := MontarCfg(Token, ExpandConstant('{param:SERVIDOR|127.0.0.1}'), ExpandConstant('{param:PORTA|3306}'), ExpandConstant('{param:USUARIO|}'),
      ExpandConstant('{param:SENHA|}'), ExpandConstant('{param:BANCO|central}'), Lojas, '0', ExpandConstant('{param:ENDERECOS|1-10}'));
    SaveStringsToUTF8File(ArqCfg(), Cfg, False);
    if Desde = '' then begin
      // sem /DESDE: só inventários abertos depois da instalação
      RodarOculto(ExpandConstant('{cmd}'), '/C ""' + ExpandConstant('{app}\node\node.exe') + '" "' + ExpandConstant('{app}\app\index.js') +
        '" --config "' + ArqCfg() + '" --maior-niven > "' + ExpandConstant('{tmp}\maior.txt') + '" 2>&1"', Codigo);
      Desde := '0';
      if LoadStringsFromFile(ExpandConstant('{tmp}\maior.txt'), Linhas) and (GetArrayLength(Linhas) > 0) and SoDigitos(Trim(Linhas[0])) then
        Desde := IntToStr(StrToIntDef(Trim(Linhas[0]), 0) + 1);
    end;
    Cfg[16] := '    "desdeNIven": ' + Desde;
    SaveStringsToUTF8File(ArqCfg(), Cfg, False);
  end else begin
    Desde := Trim(EdDesde.Text);
    if Desde = '' then Desde := IntToStr(MaiorInv + 1);
    Cfg := MontarCfg(Trim(PagToken.Values[0]), Trim(PagBanco.Values[0]), IntToStr(StrToIntDef(Trim(EdPorta.Text), 3306)),
      Trim(PagBanco.Values[1]), PagBanco.Values[2], Trim(EdBanco.Text), LojasMarcadas(), Desde, Trim(EdEnd.Text));
    SaveStringsToUTF8File(ArqCfg(), Cfg, False);
  end;
#ifndef TESTE
  // A configuração guarda a senha do banco: só Administradores e o sistema leem.
  RodarOculto(ExpandConstant('{sys}\icacls.exe'), '"' + ArqCfg() + '" /inheritance:r /grant:r *S-1-5-32-544:F *S-1-5-18:F', Codigo);
#endif
end;

// Última linha "ERRO:" do registro da instalação (gravado pelo tarefa.ps1).
function UltimoErro(Arq: String): String;
var Linhas: TArrayOfString; I, P: Integer;
begin
  Result := '';
  if LoadStringsFromFile(Arq, Linhas) then
    for I := GetArrayLength(Linhas) - 1 downto 0 do begin
      P := Pos('ERRO:', Linhas[I]);
      if P > 0 then begin Result := Trim(Copy(Linhas[I], P + 5, 1000)); Exit; end;
    end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var Codigo: Integer; Log, Motivo: String;
begin
  if CurStep = ssPostInstall then begin
    GravarConfiguracao();
#ifdef TESTE
    Exit;
#endif
    Log := PastaCfg() + '\logs\instalacao.log';
    if not RodarOculto(PowerShell(), '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\app\tarefa.ps1') +
      '" -Acao Instalar -Node "' + ExpandConstant('{app}\node\node.exe') + '" -Index "' + ExpandConstant('{app}\app\index.js') +
      '" -Config "' + ArqCfg() + '" -Log "' + Log + '"', Codigo) or (Codigo <> 0) then begin
      Motivo := UltimoErro(Log);
      if Motivo = '' then Motivo := 'código ' + IntToStr(Codigo) + ', sem detalhe no registro';
      MsgBox('Os arquivos foram instalados, mas não consegui ativar a tarefa do Windows "KontarConector".' + #13#10#13#10 +
        'Motivo: ' + Motivo + #13#10#13#10 + 'Registro completo: ' + Log, mbError, MB_OK);
    end;
  end;
end;

procedure DeinitializeSetup();
begin
  if LojasNum <> nil then LojasNum.Free;
end;
