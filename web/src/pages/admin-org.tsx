import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { Modal } from "@/components/modal";
import { Alerta } from "@/components/alerta";
import {
  DICIONARIOS,
  idiomaAtual,
  type Idioma,
  type Dicionario,
} from "@/i18n";
import {
  buscar,
  minhasOrgs,
  estaSuspensa,
  removerMembro,
  CAMINHOS,
  type Membro,
  type Dominio,
} from "@/lib/org";

// Admin da org (#1490) — UI de membros / domínios / settings / assinatura.
//
// ── A UI reflete; quem autoriza é o backend ────────────────────────────────
// Mesma doutrina da tela de login (#1484) e do delta do @Altair no #1475:
// esconder um botão é conforto, não autorização. Por isso esta tela **não
// consulta um papel local para liberar-se**: ela PEDE o recurso e reage ao que
// o backend responder. Se o backend nega (403/404), aparece o aviso de sem
// permissão — e nada de dados da org.
//
// A diferença é sutil e é o coração do AC2: uma tela que decidisse "sou admin,
// então mostro" continuaria mostrando se o papel local mentisse. Esta pergunta
// primeiro e mostra depois.
//
// ⚠️ ESCOPO (atualizado 24/08 ~23:5xZ): o #1475-BE foi entregue e o contrato
// v1.2 já traz rotas E shapes do admin. O que ainda não existe é a **borda
// HTTP** (#1505) — os crates `platform-*` são bibliotecas. Portanto AC2 e AC3
// seguem **não provados de ponta a ponta**; o que está provado aqui é a metade
// do cliente: a UI reage à negativa, distingue 403 de 404, e não inventa nem
// rota nem campo (as duas guardas do canal que barra).

type Aba = "membros" | "dominios" | "settings" | "assinatura";

const ABAS: readonly Aba[] = ["membros", "dominios", "settings", "assinatura"];

/**
 * Chaves do dicionário cujo valor é TEXTO.
 *
 * Não é purismo: `keyof Dicionario` deixava passar entradas que não são string
 * — e passou. O #1484 acrescentou `entrarCom: Record<provedor, string>` (rótulo
 * por provedor federado) e o `tsc` do CI reprovou o meu `t[ROTULO[aba]]` como
 * `ReactNode` inválido. Eu não tinha visto porque **o CI compila a merge-ref e
 * eu compilava só a minha branch**: o erro nasceu da COMBINAÇÃO, não de nenhum
 * dos dois lados. Restringir o tipo aqui faz a próxima entrada não-string
 * reprovar na hora de escrever, não na de mesclar.
 */
type ChaveDeTexto = {
  [K in keyof Dicionario]: Dicionario[K] extends string ? K : never;
}[keyof Dicionario];

/** Rótulo de cada aba — `settings` reusa `configuracoes` do dicionário. */
const ROTULO: Record<Aba, ChaveDeTexto> = {
  membros: "membros",
  dominios: "dominios",
  settings: "configuracoes",
  assinatura: "assinatura",
};

/**
 * `org` é o identificador da organização, exigido pelo contrato (`/orgs/{org}`).
 *
 * A fonte dele é o **`GET /me/orgs`**, que o @Altair criou pra fechar a lacuna
 * que eu levantei: o cliente não guarda slug de lugar nenhum — pergunta ao
 * servidor quais orgs a SESSÃO tem. A prop segue existindo para os testes
 * poderem injetar; quando ausente, a tela descobre sozinha.
 *
 * Enquanto a descoberta não volta (ou volta vazia), a tela DIZ que não sabe —
 * em vez de chutar uma org, que é o que o invariante 6 impede.
 */
export function AdminOrgPage({
  idioma = idiomaAtual(),
  org,
}: {
  idioma?: Idioma;
  org?: string;
}) {
  const t = DICIONARIOS[idioma];
  const [aba, setAba] = useState<Aba>("membros");
  const [descoberta, setDescoberta] = useState<string | null>(org ?? null);
  const [semSessao, setSemSessao] = useState(false);
  // Só ANUNCIA a suspensão; não guarda nada. Ver `estaSuspensa` em `lib/org.ts`.
  const [suspensa, setSuspensa] = useState(false);

  useEffect(() => {
    if (org) return; // injetada: não perguntar
    let vivo = true;
    void minhasOrgs().then((r) => {
      if (!vivo) return;
      // 401 é falta de LOGIN, não de org. Sem isto a tela dizia "organização
      // não identificada" a quem simplesmente não está logado — defeito MEDIDO
      // contra a borda real, que nenhum duplo revelava.
      if (r.estado === "naoAutenticado") {
        setSemSessao(true);
        return;
      }
      // Uma org por principal hoje; a lista existe pro dia em que forem várias.
      // Pegar a primeira é escolha do CLIENTE sobre o que exibir — não sobre o
      // que pode. Quando houver mais de uma, isto vira um seletor.
      if (r.estado === "pronto" && r.dados.length > 0) {
        const primeira = r.dados[0];
        setDescoberta(primeira?.org ?? null);
        // `/me/orgs` SOBREVIVE a suspensao por decisao de contrato (v1.4):
        // "senao o usuario nao alcanca a tela que explica". E daqui, portanto,
        // que a explicacao pode chegar antes do primeiro 403 -- e nao em vez
        // dele: o painel continua pedindo o recurso e continua reagindo ao que
        // o servidor responder.
        setSuspensa(primeira ? estaSuspensa(primeira) : false);
      }
    });
    return () => {
      vivo = false;
    };
  }, [org]);

  // Mesmo sinal que a tela de conta usa (#1489): a não-autenticação manda ao
  // login, não a uma mensagem que descreve outro problema.
  if (semSessao) return <Navigate to="/login" replace />;

  const orgAtual = org ?? descoberta;

  return (
    <main className="min-h-screen bg-neutral-50 p-6">
      <header className="mx-auto max-w-4xl">
        <h1 className="text-xl font-semibold text-neutral-900">{t.adminOrg}</h1>
      </header>

      <nav className="mx-auto mt-6 flex max-w-4xl gap-1" aria-label={t.adminOrg}>
        {ABAS.map((chave) => (
          <button
            key={chave}
            type="button"
            aria-current={aba === chave ? "page" : undefined}
            onClick={() => setAba(chave)}
            className={
              aba === chave
                ? "rounded-lg bg-neutral-900 px-3 py-1.5 text-sm text-white"
                : "rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-200"
            }
          >
            {t[ROTULO[chave]]}
          </button>
        ))}
      </nav>

      {/* O `Aviso` dos painéis também é `role="status"`. Sem um NOME, as duas
          regiões vivas ficam indistinguíveis — pro teste e, o que importa mais,
          pra quem usa leitor de tela: duas coisas diferentes anunciando-se com
          a mesma identidade. */}
      {suspensa ? (
        <Alerta
          tom="aviso"
          titulo={t.orgSuspensa}
          detalhe={t.orgSuspensaDetalhe}
          className="mx-auto mt-4 max-w-4xl"
        />
      ) : null}

      <section className="mx-auto mt-4 max-w-4xl rounded-2xl border border-neutral-200 bg-white p-6">
        {!orgAtual ? (
          <Aviso titulo={t.orgIndefinida} detalhe={t.orgIndefinidaDetalhe} />
        ) : aba === "membros" ? (
          <PainelMembros idioma={idioma} org={orgAtual} suspensa={suspensa} />
        ) : aba === "dominios" ? (
          <PainelDominios idioma={idioma} org={orgAtual} suspensa={suspensa} />
        ) : (
          <PainelPendente
            titulo={t[ROTULO[aba]]}
            idioma={idioma}
            caminho={CAMINHOS[aba](orgAtual)}
          />
        )}
      </section>
    </main>
  );
}

type EstadoRecurso =
  | "carregando"
  | "naoAutenticado"
  | "naoEhAdmin"
  | "orgSuspensa"
  | "naoEhSuaOrg"
  | "erro"
  | "pronto";

/**
 * O que renderizar quando o recurso **não** chegou — num lugar só.
 *
 * Nasceu quando o `orgSuspensa` entrou (contrato v1.4): os dois painéis
 * repetiam a mesma escada de `if`, e eu teria de acertar o estado novo duas
 * vezes. Acertar em um e esquecer no outro é o defeito que o ponto único
 * impede — é o mesmo conserto que o @castor fez no #1279 pro `ResizableHandle`.
 * O `useRecurso` já unificava de ONDE vem o estado; faltava unificar o que ele
 * VIRA na tela.
 *
 * Devolve `null` só para `pronto`. O `switch` é exaustivo de propósito: se um
 * estado novo aparecer e ninguém o tratar, o `tsc` reclama do retorno — em vez
 * de o estado escorrer silenciosamente pro caminho de conteúdo, que é
 * justamente o jeito permissivo de errar.
 */
function avisoDoEstado(
  estado: EstadoRecurso,
  t: Dicionario,
  /**
   * A faixa da página já anunciou a suspensão?
   *
   * Existe por um defeito que **só a e2e do composto revelou**: com uma org de
   * fato suspensa, a faixa (que lê `estado` de `/me/orgs`) e o painel (que lê o
   * `403 org_suspensa`) diziam a MESMA frase, empilhada — a tela gaguejava.
   *
   * Nenhum teste meu pegava: cada um exercitava um caminho por vez, e os dois
   * só se encontram quando existe uma org suspensa de verdade do outro lado.
   *
   * O painel **não** deixa de falar — ele passa a dizer o que é DELE ("este
   * conteúdo não vem"), em vez de reexplicar o estado da org. Continua correto
   * sozinho: se a faixa não subir (org injetada por prop, ou `/me/orgs`
   * falhando), o painel volta à mensagem completa, que aí é o único sinal.
   */
  faixaJaAnunciou = false,
): ReactElement | null {
  switch (estado) {
    case "carregando":
      return <p>{t.carregando}</p>;
    // 401 = sem sessão ⇒ login. Vem ANTES de 403/404 porque "não estás logado"
    // não é um caso de permissão dentro da org — é a ausência de sessão.
    case "naoAutenticado":
      return <Navigate to="/login" replace />;
    // Três negativas, três mensagens. Ver `lib/org.ts`: quem leva 403 `negado`
    // já é da org e a instrução "peça a um admin" é acionável; quem leva 403
    // `org_suspensa` também é da org, mas nenhum admin resolve o caso dele; quem
    // leva 404 não pertence, e a mensagem não pode confirmar que a org existe.
    case "naoEhAdmin":
      return <Aviso titulo={t.semPermissao} detalhe={t.semPermissaoDetalhe} />;
    case "orgSuspensa":
      return faixaJaAnunciou ? (
        <p>{t.orgSuspensaPainel}</p>
      ) : (
        <Aviso titulo={t.orgSuspensa} detalhe={t.orgSuspensaDetalhe} />
      );
    case "naoEhSuaOrg":
      return <Aviso titulo={t.naoEhSuaOrg} detalhe={t.naoEhSuaOrgDetalhe} />;
    case "erro":
      return <p>{t.erroCarregar}</p>;
    case "pronto":
      return null;
  }
}

/**
 * A máquina de estados que TODO painel de leitura do admin compartilha.
 *
 * Extraída quando o segundo painel nasceu (domínios). Duplicá-la faria a
 * distinção **403 ≠ 404** — que é decisão de desenho, não detalhe — depender de
 * dois acertos independentes, e o terceiro painel dependeria de três. É a mesma
 * razão da porta de rede única: um invariante deve morar num lugar só.
 */
function useRecurso<T>(caminho: string): {
  estado: EstadoRecurso;
  dados: T | null;
  /**
   * Relê do SERVIDOR. Existe para as escritas (#1490 fatia 3): depois de um
   * `DELETE` a lista tem de vir da borda, não de uma remoção otimista no
   * array local.
   *
   * A diferença não é estética. Otimista, a tela mostraria o resultado que o
   * cliente **supôs** — e se a borda tivesse recusado por uma razão que o
   * cliente não modela, ou removido mais do que o pedido, a tela mentiria até
   * ao próximo F5. Reler é a única forma de o que está no ecrã ser o que está
   * no servidor.
   */
  recarregar: () => void;
} {
  const [estado, setEstado] = useState<EstadoRecurso>("carregando");
  const [dados, setDados] = useState<T | null>(null);
  const [gatilho, setGatilho] = useState(0);

  useEffect(() => {
    let vivo = true;
    setEstado("carregando");
    void buscar<T>(caminho).then((r) => {
      if (!vivo) return;
      setEstado(r.estado === "pronto" ? "pronto" : r.estado);
      if (r.estado === "pronto") setDados(r.dados);
    });
    return () => {
      vivo = false;
    };
  }, [caminho, gatilho]);

  const recarregar = useCallback(() => setGatilho((n) => n + 1), []);

  return { estado, dados, recarregar };
}

/**
 * Confirmação de remoção — **nomeia quem sai e diz o efeito**.
 *
 * Mesmo desenho do `ConfirmarSuspensao` do back-office, e pela mesma razão que
 * lá está escrita: um "tem certeza?" genérico clica-se no automático. Aqui o
 * dano é uma pessoa fora da organização com a sessão cortada na hora, então
 * quem confirma tem de LER o nome e o e-mail de quem vai remover.
 *
 * O e-mail vai junto de propósito: dois membros podem chamar-se igual, e o
 * nome sozinho não distingue quem está prestes a perder o acesso.
 */
function ConfirmarRemocao({
  idioma,
  membro,
  aRemover,
  aoConfirmar,
  aoCancelar,
}: {
  idioma: Idioma;
  membro: Membro;
  /** O `DELETE` está em voo — 2º P2 do Codex na PR #1626. */
  aRemover: boolean;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}) {
  const t = DICIONARIOS[idioma];
  return (
    <Modal rotulo={t.removerTitulo} aoFechar={aoCancelar}>
      <h2 className="font-medium text-neutral-900">{t.removerTitulo}</h2>
      <p className="mt-2 text-neutral-900">
        <strong>{membro.nome}</strong>
      </p>
      <p className="text-neutral-600">{membro.email}</p>
      <p className="mt-2 text-neutral-500">{t.removerAviso}</p>
      <div className="mt-4 flex justify-end gap-2">
        {/* CANCELAR primeiro no DOM de propósito: é ele que recebe o foco
            inicial (o `Modal` foca o primeiro focável). Num caminho
            destrutivo, o foco de entrada não pode cair no botão que destrói —
            um Enter reflexo apagaria alguém. */}
        <button
          type="button"
          onClick={aoCancelar}
          disabled={aRemover}
          className="rounded-lg px-3 py-1.5 text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
        >
          {t.cancelar}
        </button>
        <button
          type="button"
          onClick={aoConfirmar}
          disabled={aRemover}
          className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {aRemover ? t.removendo : t.remover}
        </button>
      </div>
    </Modal>
  );
}

/** Membros — `GET /orgs/{org}/membros` + `DELETE /orgs/{org}/membros/{uid}`. */
function PainelMembros({
  idioma,
  org,
  suspensa,
}: {
  idioma: Idioma;
  org: string;
  suspensa: boolean;
}) {
  const t = DICIONARIOS[idioma];
  const { estado, dados, recarregar } = useRecurso<Membro[]>(
    CAMINHOS.membros(org),
  );
  const membros = dados ?? [];
  const [aConfirmar, setAConfirmar] = useState<Membro | null>(null);
  /**
   * O `uid` cujo `DELETE` está em voo, ou `null`.
   *
   * 2º P2 do Codex: sem isto, um `DELETE` lento fecha o diálogo, deixa a tabela
   * inteira acionável e **sem sinal nenhum** — dá para abrir outra remoção e
   * disparar pedidos destrutivos concorrentes, sem se saber qual está em curso.
   * Guardo o `uid` e não um booleano porque a tabela precisa de saber QUAL
   * linha está a sair.
   */
  const [aRemover, setARemover] = useState<string | null>(null);
  /**
   * A recusa da borda, quando houve uma.
   *
   * Guardo o ESTADO devolvido, não uma frase — a frase escolhe-se na
   * renderização, a partir do dicionário do idioma corrente. Guardar texto aqui
   * congelaria o idioma no instante do clique.
   */
  const [recusa, setRecusa] = useState<
    "ultimoAdmin" | "conflito" | "erro" | null
  >(null);

  const aviso = avisoDoEstado(estado, t, suspensa);
  if (aviso) return aviso;

  async function confirmar(membro: Membro) {
    setRecusa(null);
    setARemover(membro.uid);
    const r = await removerMembro(org, membro.uid);
    setARemover(null);
    setAConfirmar(null);
    if (r.estado === "feito") {
      // RELÊ do servidor. Nada de tirar a linha do array local: ver o
      // `recarregar` do `useRecurso`.
      recarregar();
      return;
    }
    if (r.estado === "ultimoAdmin") {
      setRecusa("ultimoAdmin");
      return;
    }
    if (r.estado === "conflito") {
      setRecusa("conflito");
      return;
    }
    // As restantes (401/403/404) são estados da PÁGINA, não desta linha: relê e
    // deixa o `avisoDoEstado` dizer o que é — é ele que já distingue 403 de 404
    // e a org suspensa. Repetir essa escada aqui seria o segundo acerto que o
    // ponto único existe para evitar.
    if (
      r.estado === "naoAutenticado" ||
      r.estado === "naoEhAdmin" ||
      r.estado === "orgSuspensa" ||
      r.estado === "naoEhSuaOrg"
    ) {
      recarregar();
      return;
    }
    setRecusa("erro");
  }

  return (
    <>
      {recusa === "ultimoAdmin" ? (
        // Região viva NOMEADA — a página já tem outra (`role="status"` da faixa
        // de suspensão), e duas sem nome ficam indistinguíveis para quem usa
        // leitor de ecrã. Foi o achado da @Íris no #1544.
        <Alerta
          tom="aviso"
          titulo={t.ultimoAdmin}
          detalhe={t.ultimoAdminDetalhe}
          className="mb-4"
        />
      ) : recusa !== null ? (
        <Alerta tom="erro" titulo={t.removerFalhou} className="mb-4" />
      ) : null}

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-neutral-500">
            <th className="pb-2 font-medium">{t.nome}</th>
            <th className="pb-2 font-medium">{t.email}</th>
            <th className="pb-2 font-medium">{t.papel}</th>
            <th className="pb-2 font-medium">
              <span className="sr-only">{t.remover}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {membros.map((m) => (
            <tr key={m.uid} className="border-t border-neutral-100">
              <td className="py-2 text-neutral-900">{m.nome}</td>
              <td className="py-2 text-neutral-600">{m.email}</td>
              <td className="py-2 text-neutral-600">
                {/* Rótulo do papel — leitura, não permissão. Ver `lib/org.ts`. */}
                {m.papel === "org_admin" ? t.papelAdmin : t.papelMembro}
              </td>
              <td className="py-2 text-right">
                {/* O botão aparece para TODOS, inclusive o último admin. Esconder
                    seria a UI a decidir autorização — a mesma doutrina do
                    cabeçalho deste ficheiro. Quem recusa é a borda (`409
                    ultimo_admin`), e a recusa vira uma mensagem que diz o que
                    fazer a seguir. Esconder ensinaria menos e mentiria mais. */}
                <button
                  type="button"
                  onClick={() => setAConfirmar(m)}
                  disabled={aRemover !== null}
                  className="rounded-lg px-2 py-1 text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
                >
                  {aRemover === m.uid ? t.removendo : t.remover}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {aConfirmar ? (
        <ConfirmarRemocao
          idioma={idioma}
          membro={aConfirmar}
          aRemover={aRemover !== null}
          aoConfirmar={() => void confirmar(aConfirmar)}
          aoCancelar={() => setAConfirmar(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Domínios — lê `GET /orgs/{org}/dominios`, que o contrato v1.3 declarou.
 *
 * Reusa `useRecurso` com `PainelMembros`: os dois têm a mesma máquina de estados
 * (carregando / não-é-admin / não-é-sua-org / erro / pronto), e duplicá-la faria
 * a distinção 403≠404 depender de dois acertos em vez de um.
 */
function PainelDominios({
  idioma,
  org,
  suspensa,
}: {
  idioma: Idioma;
  org: string;
  suspensa: boolean;
}) {
  const t = DICIONARIOS[idioma];
  const { estado, dados } = useRecurso<Dominio[]>(CAMINHOS.dominios(org));

  const aviso = avisoDoEstado(estado, t, suspensa);
  if (aviso) return aviso;

  const dominios = dados ?? [];
  if (dominios.length === 0) return <p>{t.semDominios}</p>;

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-neutral-500">
          <th className="pb-2 font-medium">{t.dominios}</th>
          <th className="pb-2 font-medium">{t.estado}</th>
        </tr>
      </thead>
      <tbody>
        {dominios.map((d) => (
          <tr key={d.dominio} className="border-t border-neutral-100">
            <td className="py-2 text-neutral-900">{d.dominio}</td>
            <td className="py-2 text-neutral-600">
              {/* Os dois valores do contrato, nomeados. Um `estado` aberto
                  faria a UI decidir sobre um terceiro valor que ela não conhece. */}
              {d.estado === "verificado" ? t.verificado : t.pendente}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Painel cujo formato o contrato ainda NÃO declara.
 *
 * Sobrou para `settings` (o doc diz "mesmo shape do `PATCH`", e o `PATCH` não
 * declara corpo) e `assinatura` (o doc diz que a shape "nasce com o #1470",
 * bloqueado no PO). Ler "espelha o `PUT`" não é um shape — é a promessa de um.
 *
 * Deixa o caminho VISÍVEL de propósito: o que esta fatia entrega para os dois é
 * o endereço certo, e um placeholder que fingisse dados seria pior que um que
 * declara o que falta.
 */
function PainelPendente({
  titulo,
  idioma,
  caminho,
}: {
  titulo: string;
  idioma: Idioma;
  caminho: string;
}) {
  const t = DICIONARIOS[idioma];
  return (
    <div className="text-sm text-neutral-500">
      <h2 className="font-medium text-neutral-900">{titulo}</h2>
      <p className="mt-1">
        {t.carregando} <code className="text-neutral-400">{caminho}</code>
      </p>
    </div>
  );
}

/** Aviso de negativa. O texto vem de fora porque 403 e 404 dizem coisas diferentes. */
function Aviso({ titulo, detalhe }: { titulo: string; detalhe: string }) {
  // Passa a ter NOME acessível (o `Alerta` exige-o por assinatura). Antes era
  // a única região viva sem nome da página — a outra face do achado da @Íris
  // no #1544: duas `role="status"` indistinguíveis para o leitor de ecrã.
  return <Alerta tom="simples" titulo={titulo} detalhe={detalhe} />;
}
