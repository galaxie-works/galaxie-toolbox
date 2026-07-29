import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PersonHoverCard } from "@/components/people/person-hover-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import * as api from "@/lib/api";
import { useFotos } from "@/lib/fotos";
import { preencher, useIdioma } from "@/lib/idioma";
import type { Pessoa } from "@/lib/types";

/**
 * Campo de destinatários (Para/Cc/Cco) com autocomplete rico (#40).
 *
 * Casca = componentes reui instalados do registry:
 *  - `@reui/c-combobox-20` (`src/components/ui/combobox.tsx`) — Combobox
 *    múltiplo com **chips**: cada destinatário escolhido vira um chip com
 *    avatar + nome + botão de remover.
 *  - `@reui/c-autocomplete-8` (`src/components/examples/c-autocomplete-8.tsx`)
 *    — sugestões agrupadas por **seção**, cada linha com avatar + nome +
 *    cargo. Aqui as seções são "Seus contatos" (`/me/people`) e "De sua
 *    organização" (diretório `/users`), que é o que o backend marca em
 *    `Pessoa.origem`.
 *
 * O avatar usa a foto real do contato interno pelo cache do #39 (`useFotos`),
 * caindo nas iniciais (`AvatarFallback`) quando não há foto — mesmo padrão da
 * lista de e-mails. Fora do Tauri (mock) nunca há foto: só iniciais.
 *
 * A busca é server-side (`api.crPessoas`, debounce ~250ms), então o filtro
 * interno do combobox fica desligado (`filter={null}`).
 *
 * Quem não está no diretório continua sendo aceito: um endereço digitado por
 * inteiro aparece na seção "Usar o endereço digitado" e também entra com
 * Enter, vírgula ou ponto-e-vírgula. Backspace com o input vazio remove o
 * último chip (comportamento nativo do `ComboboxChips`).
 */
export interface CampoPessoasProps {
  rotulo: string;
  valor: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  /**
   * Reporta os destinatários escolhidos como `Pessoa` (nome/e-mail/foto), não só
   * os e-mails de `valor`. Usado pelo compose para alimentar o autocomplete de
   * menção (@) no corpo com avatar + nome (#106). Dispara sempre que a lista de
   * escolhidos muda.
   */
  onPessoas?: (pessoas: Pessoa[]) => void;
}

/** Grupo no formato que o Base UI espera em `items` (precisa da chave `items`). */
interface GrupoPessoas {
  rotulo: string;
  items: Pessoa[];
}

/** Endereço "inteiro o bastante" para virar destinatário sem estar no diretório. */
function emailValido(texto: string): boolean {
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(texto.trim());
}

/** Iniciais do avatar: do nome quando há nome de verdade, senão do e-mail. */
function iniciaisDe(nome: string, email: string): string {
  const base = nome && !nome.includes("@") ? nome : email.split("@")[0];
  const partes = base.split(/[\s._-]+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function mesmoEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function CampoPessoas({
  rotulo,
  valor,
  onChange,
  placeholder,
  onPessoas,
}: CampoPessoasProps) {
  const { t } = useIdioma();
  const textos = t.controlRoom;

  const [texto, setTexto] = useState("");
  const [sugestoes, setSugestoes] = useState<Pessoa[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [aberto, setAberto] = useState(false);
  /** Detalhes (nome/cargo) dos e-mails já escolhidos, para pintar os chips. */
  const [detalhes, setDetalhes] = useState<Record<string, Pessoa>>({});

  const anchor = useComboboxAnchor();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Marca o pedido em voo pra descartar respostas fora de ordem.
  const pedidoRef = useRef(0);
  // Item destacado no popup: com nada destacado, Enter commita o que foi digitado.
  const destacadoRef = useRef<Pessoa | undefined>(undefined);

  const { getFoto, pedirFotos } = useFotos();

  // Debounce da busca, descartando respostas obsoletas.
  useEffect(() => {
    const q = texto.trim();
    if (timerRef.current) clearTimeout(timerRef.current);

    if (q.length < 1) {
      setSugestoes([]);
      setCarregando(false);
      setAberto(false);
      return;
    }

    setCarregando(true);
    timerRef.current = setTimeout(() => {
      const meu = ++pedidoRef.current;
      api
        .crPessoas(q)
        .then((res) => {
          if (meu !== pedidoRef.current) return; // resposta obsoleta
          setSugestoes(res);
          setCarregando(false);
          setAberto(res.length > 0 || emailValido(q));
        })
        .catch(() => {
          if (meu !== pedidoRef.current) return;
          setSugestoes([]);
          setCarregando(false);
          setAberto(emailValido(q));
        });
    }, 250);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [texto]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      pedidoRef.current++; // invalida qualquer resposta pendente
    };
  }, []);

  // Fotos (#39) dos escolhidos + das sugestões visíveis: o cache filtra o que
  // é externo/já resolvido e junta tudo num lote só.
  useEffect(() => {
    const emails = [...valor, ...sugestoes.map((p) => p.email)];
    if (emails.length > 0) pedirFotos(emails);
  }, [valor, sugestoes, pedirFotos]);

  // Destinatários como `Pessoa` (o valor do combobox). Quem foi digitado à mão
  // e não tem detalhe conhecido aparece com o próprio e-mail como nome.
  const selecionados = useMemo<Pessoa[]>(
    () =>
      valor.map(
        (email) => detalhes[email.trim().toLowerCase()] ?? { nome: email, email }
      ),
    [valor, detalhes]
  );

  // Espelha os escolhidos (com nome/foto) para o compose alimentar a menção @
  // no corpo (#106). `selecionados` é memoizado por [valor, detalhes], então só
  // dispara quando a lista realmente muda.
  useEffect(() => {
    onPessoas?.(selecionados);
  }, [selecionados, onPessoas]);

  // Seções do popup: o endereço digitado primeiro (é o que o Enter/seta pega),
  // depois "Seus contatos" e "De sua organização". Seção vazia não aparece.
  const grupos = useMemo<GrupoPessoas[]>(() => {
    const q = texto.trim();
    const out: GrupoPessoas[] = [];

    const jaSugerido = sugestoes.some((p) => mesmoEmail(p.email, q));
    const jaEscolhido = valor.some((e) => mesmoEmail(e, q));
    if (emailValido(q) && !jaSugerido && !jaEscolhido) {
      out.push({ rotulo: textos.secaoDigitado, items: [{ nome: q, email: q }] });
    }

    // "Seus contatos" = SÓ os contatos pessoais (origem `contatos` = /me/contacts).
    // Qualquer outra origem — inclusive `organizacao` (diretório /users) e o caso
    // ambíguo sem origem — cai em "De sua organização". Assim ninguém do tenant
    // aparece indevidamente sob "Seus contatos" (bug reportado pelo PO no #40).
    const contatos = sugestoes.filter((p) => p.origem === "contatos");
    if (contatos.length > 0) {
      out.push({ rotulo: textos.secaoSeusContatos, items: contatos });
    }
    const organizacao = sugestoes.filter((p) => p.origem !== "contatos");
    if (organizacao.length > 0) {
      out.push({ rotulo: textos.secaoOrganizacao, items: organizacao });
    }
    return out;
  }, [texto, sugestoes, valor, textos]);

  /** Guarda o detalhe de uma pessoa para o chip mostrar nome/cargo/foto. */
  function lembrar(pessoas: Pessoa[]) {
    setDetalhes((atual) => {
      const novo = { ...atual };
      for (const p of pessoas) novo[p.email.trim().toLowerCase()] = p;
      return novo;
    });
  }

  function aplicar(pessoas: Pessoa[]) {
    lembrar(pessoas);
    const emails: string[] = [];
    for (const p of pessoas) {
      const email = p.email.trim();
      if (!email || emails.some((e) => mesmoEmail(e, email))) continue;
      emails.push(email);
    }
    onChange(emails);
    setTexto("");
    setAberto(false);
  }

  /** Commita o texto cru do input (endereço fora do diretório). */
  function adicionarDigitado() {
    const email = texto.trim().replace(/[,;]+$/, "").trim();
    if (!email) return;
    if (valor.some((e) => mesmoEmail(e, email))) {
      setTexto("");
      setAberto(false);
      return;
    }
    aplicar([...selecionados, { nome: email, email }]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Vírgula e ponto-e-vírgula não são teclas do combobox: separador clássico
    // de destinatário, commita o que estiver digitado.
    if (e.key === "," || e.key === ";") {
      if (texto.trim()) {
        e.preventDefault();
        adicionarDigitado();
      }
      return;
    }
    // Enter com um item destacado é do combobox (seleciona a sugestão); sem
    // nada destacado, vale o endereço digitado.
    if (e.key === "Enter" && !destacadoRef.current && emailValido(texto)) {
      e.preventDefault();
      adicionarDigitado();
    }
  }

  return (
    <div className="flex items-start gap-2 px-3 py-2">
      <span className="mt-1.5 shrink-0 select-none text-xs text-muted-foreground">
        {rotulo}
      </span>

      <Combobox
        multiple
        items={grupos}
        filter={null}
        openOnInputClick={false}
        value={selecionados}
        onValueChange={aplicar}
        inputValue={texto}
        onInputValueChange={setTexto}
        open={aberto}
        onOpenChange={setAberto}
        onItemHighlighted={(item) => {
          destacadoRef.current = item;
        }}
        itemToStringLabel={(p: Pessoa) => p.nome || p.email}
        itemToStringValue={(p: Pessoa) => p.email}
        isItemEqualToValue={(a: Pessoa, b: Pessoa) => mesmoEmail(a.email, b.email)}
      >
        <ComboboxChips
          ref={anchor}
          className="min-h-auto flex-1 border-none bg-transparent p-0 shadow-none ring-0 focus-within:border-transparent focus-within:ring-0 dark:bg-transparent"
        >
          <ComboboxValue>
            {(escolhidos: Pessoa[]) => (
              <Fragment>
                {escolhidos.map((p) => {
                  const foto = p.foto ?? getFoto(p.email);
                  const rotuloRemover = preencher(textos.removerDestinatario, {
                    nome: p.nome || p.email,
                  });
                  return (
                    <PersonHoverCard
                      key={p.email.toLowerCase()}
                      email={p.email}
                      fallback={{ ...p, foto }}
                    >
                      <ComboboxChip
                        aria-label={rotuloRemover}
                        tabIndex={0}
                        showRemove={true}
                        className="bg-background rounded-full inline-flex h-auto items-center gap-1.5 border py-0.5 pl-2 shadow-xs **:data-[slot=combobox-chip-remove]:mr-0.5 **:data-[slot=combobox-chip-remove]:bg-transparent"
                      >
                        <Avatar className="size-4">
                          {foto && <AvatarImage src={foto} alt="" />}
                          <AvatarFallback className="text-[8px]">
                            {iniciaisDe(p.nome, p.email)}
                          </AvatarFallback>
                        </Avatar>
                        {p.nome || p.email}
                      </ComboboxChip>
                    </PersonHoverCard>
                  );
                })}
                <ComboboxChipsInput
                  aria-label={rotulo}
                  placeholder={
                    valor.length === 0
                      ? (placeholder ?? textos.destinatariosPlaceholder)
                      : undefined
                  }
                  onKeyDown={onKeyDown}
                  className="bg-transparent"
                />
              </Fragment>
            )}
          </ComboboxValue>
        </ComboboxChips>

        <ComboboxContent
          anchor={anchor}
          // `pointer-events-auto`: o compose é um Sheet MODAL (Radix Dialog), que
          // trava `body { pointer-events: none }` enquanto aberto. Como este popup
          // é portalado no body (irmão do Sheet), sem isto ele HERDA o none e o
          // mouse "atravessa" para a toolbar de baixo — era o que fazia o hover
          // vazar o tooltip "Anexar arquivo" e a roda do mouse rolar o editor em
          // vez da lista. `flex flex-col` para o ScrollArea preencher a altura.
          className="pointer-events-auto flex max-w-(--anchor-width) min-w-(--anchor-width) flex-col"
        >
          <ComboboxEmpty>
            {carregando ? textos.buscandoContatos : textos.semContatos}
          </ComboboxEmpty>
          {/* Scroll no padrão do app: o ScrollArea (radix) que o resto do Bridge
              usa (mesma casca do reui/autocomplete). A lista perde o overflow
              nativo e quem rola é o viewport do ScrollArea — a roda do mouse e o
              scroll-into-view do teclado (↑/↓) agem sobre ele. */}
          <ScrollArea className="min-h-0 flex-1 **:data-[slot=scroll-area-viewport]:max-h-80 **:data-[slot=scroll-area-viewport]:overscroll-contain">
            <ComboboxList className="max-h-none overflow-visible">
              {(grupo: GrupoPessoas) => (
              <ComboboxGroup key={grupo.rotulo} items={grupo.items}>
                <ComboboxLabel className="bg-popover sticky top-0 z-10 py-2 text-xs font-medium">
                  {grupo.rotulo}
                </ComboboxLabel>
                <ComboboxCollection>
                  {(p: Pessoa) => {
                    const foto = p.foto ?? getFoto(p.email);
                    // 2ª linha: cargo + e-mail. No endereço digitado o "nome"
                    // é o próprio e-mail — aí a 2ª linha sairia repetida.
                    const temNome = !!p.nome && p.nome !== p.email;
                    const detalhe = [p.cargo, temNome ? p.email : null]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <ComboboxItem
                        key={p.email.toLowerCase()}
                        value={p}
                        className="flex items-center gap-2.5 rounded-lg"
                      >
                        <Avatar className="size-9">
                          {foto && <AvatarImage src={foto} alt="" />}
                          <AvatarFallback>
                            {iniciaisDe(p.nome, p.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">
                            {p.nome || p.email}
                          </div>
                          {detalhe ? (
                            <div className="text-muted-foreground truncate text-sm">
                              {detalhe}
                            </div>
                          ) : null}
                        </div>
                      </ComboboxItem>
                    );
                  }}
                </ComboboxCollection>
              </ComboboxGroup>
              )}
            </ComboboxList>
          </ScrollArea>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
