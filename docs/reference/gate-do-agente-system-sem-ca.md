# Gate do agente SYSTEM sem CA paga — re-derivação

**Autor:** Altair · **Medido em:** `feat` `f3bc917` (2026-08-18) · `Ref #1164`, `Ref #1052`, `Ref #690`
**Gatilho:** decisão do PO — *"eu não vou pagar um certificado pra um system agent funcionar"*.

O `Polaris` pediu re-derivação, não repetição, e disse que aceitaria como resposta *"sem CA não dá pra proteger isso"*. **A resposta honesta é diferente das duas — e é mais útil.**

---

## Conclusão, antes do raciocínio

> **O pin de Authenticode — com CA ou sem CA — nunca foi a fronteira desta ameaça. Comprar o certificado não teria comprado a segurança que a gente achou que estava comprando.**

Não é *"sem CA não dá"*. É *"nenhuma checagem de identidade do chamador dá"*, e isso vale igual para o caminho pago. A decisão do PO **não** nos custou segurança. Ela nos poupou US$ 200/ano por uma propriedade que não existia.

O que muda: a fronteira precisa sair de **"quem é o binário que chamou"** e ir para **"quem assinou esta sessão"** — que é infraestrutura que **já existe no repo** e custa R$ 0.

---

## 1. A cadeia, medida

**1. O pipe já limita quem conecta.** A DACL restringe a SYSTEM + SID do logon (#1076). ⇒ o adversário relevante **é um processo rodando como o usuário logado**. Isso o `Polaris` já tinha ancorado certo na #1164.

**2. No modo attended, a autoridade é a presença local.** `session_channel.rs:84-90` — `ModoSessao::Attended` = *"autoridade = presença local; ticket opcional"*. E `PresencaLocal` (`:103-106`) é exatamente dois fatos: `owner_session_id` e `authenticode_ok`.

**3. O que o `authenticode_ok` prova.** `pipe_server.rs:242` → `caminho_imagem(pid)` → `WinVerifyTrust` no **arquivo de imagem do PID que conectou**. Ou seja: prova uma propriedade do **arquivo em disco**, não do **código que está executando**.

**4. E é aí que quebra.** Um processo do mesmo usuário pode injetar no nosso processo assinado — `OpenProcess` com acesso total no próprio usuário é permitido por padrão, e o Toolbox não é PPL. O código injetado fala pelo pipe a partir de um PID **cuja imagem é o nosso binário assinado**, e **passa no gate**.

> **`PresencaLocal` não distingue "o nosso app" de "malware do mesmo usuário que injetou no nosso app".** Nenhum pin conserta isso: o pin qualifica o arquivo, e o atacante não precisou tocar no arquivo.

## 2. Por que isso importa aqui e não é academicismo

Porque o que está do outro lado do gate **é uma fronteira de privilégio de verdade**:

`lib.rs:21-24` — `DesktopMode { Auto, Default, Winlogon }`. **`Winlogon` é o desktop seguro** — a tela do UAC e do login. O comentário do `autorizacao.rs:150` sabe disso: *"sem a cap de input, o frame de input é NEGADO (o mais crítico: **secure desktop**)"*.

Injetar input no desktop seguro é **estritamente mais** do que o usuário logado consegue fazer sozinho: é clicar "Sim" num UAC. Não é defesa em profundidade — é elevação.

### E tem um agravante estrutural que o card não menciona

**O desktop NÃO é uma capability. É argumento de linha de comando.**

- `lib.rs:55` — `pub desktop: DesktopMode` vive em `AgentArgs`, parseado de `"auto|default|winlogon"` (`:37-46`);
- `Capabilities` (`remote-net/src/protocol.rs:55-61`) tem `screen`, `input`, `file_transfer`, `clipboard`, `audio` — **e nenhum campo de desktop**.

⇒ Quem decide se o agente enxerga o desktop seguro é **quem sobe o processo**, não a autoridade da sessão. Com o agente rodando em `--desktop winlogon`, **qualquer sessão que ganhe `caps.input` alcança a tela do UAC** — inclusive uma sessão attended cuja autoridade é a presença local, que o passo 4 acabou de derrubar.

## 3. As decisões

### D1 — o desktop seguro passa a exigir autoridade de **ticket**, nunca `PresencaLocal`

O ticket (`FonteAutoridade::Ticket`) é assinado pelo S8 com chave que **não está na máquina** (`authority.rs`, Ed25519). Um atacante local não forja. É a única das duas fontes de autoridade que sobrevive ao passo 4.

Invariante: **`DesktopMode::Winlogon` + `caps.input` ⇒ exige `Autoridade { fonte: Ticket, .. }`.** Presença local nunca alcança o desktop seguro.

### D2 — `desktop` sai de `AgentArgs` e vira capability autorizada

Enquanto for argumento de processo, o alcance do agente é decidido por quem o lança. Vira campo de `Capabilities`, concedido pelo servidor no `TicketClaims` — igual a `input` e `file_transfer`. Isso põe o D1 no mesmo funil que já existe, em vez de criar um caminho paralelo.

> É o mesmo princípio do #1163: **junção única, verificada pelo compilador**, em vez de guarda espalhada. Aqui é `decidir_acao` recebendo a autoridade, não só as caps.

### D3 — o pin auto-assinado entra, e **desce de posto**

Faz self-signed + pin, **de graça**, com duas correções sobre o meu §4 original:

- **o pin vai na chave pública (SPKI) ou no thumbprint da leaf — nunca em `Issuer ∧ Subject O=`.** Sem CA validando o `O=`, aquelas strings são forjáveis em segundos; o pin do §4 **morre junto com a compra**;
- o código aceita `CERT_E_UNTRUSTEDROOT` **de propósito** e recusa toda outra falha.

**Eu tinha recomendado NÃO fazer esse carve-out.** Aquele parecer estava calibrado para o pin ser a fronteira: errar o carve-out custaria a fronteira. Com o D1, o pin é **defesa em profundidade** — errar custa uma camada, não o limite. **A recomendação inverte porque o peso do erro mudou, não porque eu mudei de ideia sobre o risco.**

E ele continua valendo a pena: eleva o ataque de *"qualquer processo conecta"* para *"tem que injetar no nosso processo"*. Isso é barreira real contra script e binário oportunista — só não é barreira contra adversário dedicado.

## 4. O que fica explicitamente NÃO protegido

Escrito para ser risco conhecido, não risco esquecido:

- **Adversário rodando como o usuário logado, disposto a injetar no nosso processo, alcança tudo que a sessão attended alcança.** Nenhum gate local resolve isso sem PPL (que exige certificado EV **e** atestação da Microsoft — ou seja, o caminho pago que o PO recusou, e que aqui teria valido de verdade).
- Com o **D1**, o que ele alcança fica limitado ao que a presença local pode: **tela e input no desktop do usuário — não o desktop seguro**. É o teto certo: **igual ao que aquele usuário já podia fazer sozinho.**

## 5. Efeito no #690 (S7)

**Não é "muda de tranca", é "muda de escopo" — e é escopo menor, não bloqueado.**

O S7 pode ligar o IPC com o teto do D1: attended entrega tela + input **no desktop do usuário**. O desktop seguro fica atrás do ticket, que é o caminho do unattended, onde ele já era obrigatório (`ModoSessao::Unattended` — *"ticket obrigatório"*).

Na prática, quase não custa produto: **suporte remoto com o usuário presente raramente precisa da tela do UAC** — e quando precisa, é justamente o caso em que se quer autorização explícita do servidor, não presunção local.

## 6. O que eu recomendo responder ao PO

**A decisão dele está certa e não custou segurança.** O certificado compraria o pin, o pin não era a fronteira, e a fronteira certa (ticket assinado) **já está construída**.

O único uso de cert que sobraria era o **comercial** — o aviso de "editor desconhecido" no instalador. Concordo com o `Polaris`: **não comprar agora**, e registrar que shipamos assim **por decisão**, não por esquecimento.
