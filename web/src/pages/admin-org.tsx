import { useEffect, useState, type ReactElement } from "react";
import { Navigate } from "react-router-dom";
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
        <div
          role="status"
          aria-label={t.orgSuspensa}
          className="mx-auto mt-4 max-w-4xl rounded-2xl border border-amber-300 bg-amber-50 p-4"
        >
          <p className="text-sm font-medium text-amber-900">{t.orgSuspensa}</p>
          <p className="mt-1 text-sm text-amber-800">{t.orgSuspensaDetalhe}</p>
        </div>
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
function useRecurso<T>(caminho: string): { estado: EstadoRecurso; dados: T | null } {
  const [estado, setEstado] = useState<EstadoRecurso>("carregando");
  const [dados, setDados] = useState<T | null>(null);

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
  }, [caminho]);

  return { estado, dados };
}

/** Membros — `GET /orgs/{org}/membros`. */
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
  const { estado, dados } = useRecurso<Membro[]>(CAMINHOS.membros(org));
  const membros = dados ?? [];

  const aviso = avisoDoEstado(estado, t, suspensa);
  if (aviso) return aviso;

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-neutral-500">
          <th className="pb-2 font-medium">{t.nome}</th>
          <th className="pb-2 font-medium">{t.email}</th>
          <th className="pb-2 font-medium">{t.papel}</th>
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
          </tr>
        ))}
      </tbody>
    </table>
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
  return (
    <div role="status" className="text-sm">
      <p className="font-medium text-neutral-900">{titulo}</p>
      <p className="mt-1 text-neutral-500">{detalhe}</p>
    </div>
  );
}
