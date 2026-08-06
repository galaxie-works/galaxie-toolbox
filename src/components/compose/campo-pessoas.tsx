import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { XIcon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PersonHoverCard } from "@/components/people/person-hover-card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import {
  deveCommitarEnter,
  deveLimparAposAplicar,
  emailValido,
  mesmoEmail,
} from "./campo-pessoas-logic";

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
   * Limita a apresentação a três chips e oferece a lista completa em Popover.
   * Opt-in da Agenda: o compose de e-mail mantém o layout original.
   */
  compactarSelecionados?: boolean;
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

/** Iniciais do avatar: do nome quando há nome de verdade, senão do e-mail. */
function iniciaisDe(nome: string, email: string): string {
  const base = nome && !nome.includes("@") ? nome : email.split("@")[0];
  const partes = base.split(/[\s._-]+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export function CampoPessoas({
  rotulo,
  valor,
  onChange,
  placeholder,
  onPessoas,
  compactarSelecionados = false,
}: CampoPessoasProps) {
  const { t } = useIdioma();
  const textos = t.controlRoom;

  const [texto, setTexto] = useState("");
  const [sugestoes, setSugestoes] = useState<Pessoa[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [todosAbertos, setTodosAbertos] = useState(false);
  /** Detalhes (nome/cargo) dos e-mails já escolhidos, para pintar os chips. */
  const [detalhes, setDetalhes] = useState<Record<string, Pessoa>>({});

  const anchor = useComboboxAnchor();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Marca o pedido em voo pra descartar respostas fora de ordem.
  const pedidoRef = useRef(0);

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
    // #606: só limpamos num commit GENUÍNO. Se o combobox auto-selecionou uma
    // sugestão enquanto o usuário digitava um e-mail externo, o texto (e-mail
    // completo fora do commit) tem que ser preservado — senão o endereço some
    // no meio da digitação.
    if (deveLimparAposAplicar(texto, emails)) {
      setTexto("");
      setAberto(false);
    }
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
    // Enter commita o endereço digitado (convidado externo fora do diretório)
    // quando o texto é um e-mail completo que NÃO é uma das sugestões. Ver
    // `deveCommitarEnter`: #606 — independe do item destacado (o Base UI passou a
    // auto-destacar a 1ª sugestão, o que travava o commit e apagava o input).
    if (e.key === "Enter" && deveCommitarEnter(texto, sugestoes)) {
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
        // #606: NÃO auto-destacar a 1ª sugestão. Com a busca por relevância do
        // Graph retornando gente até pra e-mail externo, o auto-highlight fazia o
        // Base UI selecionar o item destacado DURANTE a digitação (modo multiple
        // limpa o input ao selecionar) → o endereço que o usuário digitava sumia.
        // Sem highlight automático, `onValueChange` só dispara em seleção genuína
        // (clique/Enter na sugestão), e o Enter de e-mail livre é nosso (onKeyDown).
        autoHighlight={false}
        value={selecionados}
        onValueChange={aplicar}
        inputValue={texto}
        onInputValueChange={setTexto}
        open={aberto}
        onOpenChange={setAberto}
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
                {compactarSelecionados ? (
                  /* O corte conservador impede que chips escondidos pelo
                     overflow continuem no tab order. O valor completo segue
                     no Combobox e no Popover. */
                  <div className="flex max-h-[4.875rem] min-w-0 basis-full flex-wrap items-start gap-1.5 overflow-hidden">
                    {escolhidos.slice(0, 3).map((p) => {
                      const foto = p.foto ?? getFoto(p.email);
                      const nome = p.nome || p.email;
                      const rotuloRemover = preencher(
                        textos.removerDestinatario,
                        { nome }
                      );
                      return (
                        // #478: uniformiza com o ramo não-compactado — mesmo
                        // PersonHoverCard (avatar/nome/ações) no lugar do Tooltip.
                        <PersonHoverCard
                          key={p.email.toLowerCase()}
                          email={p.email}
                          fallback={{ ...p, foto }}
                        >
                          <ComboboxChip
                            aria-label={rotuloRemover}
                            tabIndex={0}
                            showRemove={true}
                            className="bg-background inline-flex h-auto min-w-0 max-w-48 items-center gap-1.5 rounded-full border py-0.5 pl-2 shadow-xs **:data-[slot=combobox-chip-remove]:mr-0.5 **:data-[slot=combobox-chip-remove]:bg-transparent"
                          >
                            <Avatar className="size-4 shrink-0">
                              {foto && <AvatarImage src={foto} alt="" />}
                              <AvatarFallback className="text-[8px]">
                                {iniciaisDe(p.nome, p.email)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="min-w-0 truncate">{nome}</span>
                          </ComboboxChip>
                        </PersonHoverCard>
                      );
                    })}
                  </div>
                ) : (
                  escolhidos.map((p) => {
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
                  })
                )}

                {compactarSelecionados && escolhidos.length > 3 && (
                  <Popover open={todosAbertos} onOpenChange={setTodosAbertos}>
                    <PopoverTrigger
                      type="button"
                      className="cursor-pointer truncate rounded-sm px-1.5 py-1 text-start text-xs text-muted-foreground hover:text-foreground"
                      aria-label={preencher(
                        textos.agendaMostrarTodosConvidados,
                        { count: escolhidos.length }
                      )}
                    >
                      {preencher(textos.agendaMostrarTodosConvidados, {
                        count: escolhidos.length,
                      })}
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="pointer-events-auto w-80 gap-2 p-2"
                      aria-label={textos.agendaTodosConvidados}
                    >
                      <p className="px-2 text-xs font-medium text-muted-foreground">
                        {textos.agendaTodosConvidados}
                      </p>
                      <ScrollArea className="**:data-[slot=scroll-area-viewport]:max-h-64">
                        <div className="space-y-1">
                          {escolhidos.map((p) => {
                            const foto = p.foto ?? getFoto(p.email);
                            const nome = p.nome || p.email;
                            const rotuloRemover = preencher(
                              textos.removerDestinatario,
                              { nome }
                            );
                            return (
                              <div
                                key={p.email.toLowerCase()}
                                className="flex items-center gap-2 rounded-md px-2 py-1.5"
                              >
                                {/* #478 rework: a lista "ver todos" usa o mesmo
                                    PersonHoverCard dos chips (avatar/nome/ações),
                                    no lugar do title nativo. O botão remover fica
                                    fora do trigger. */}
                                <PersonHoverCard
                                  email={p.email}
                                  fallback={{ ...p, foto }}
                                >
                                  <div className="flex min-w-0 flex-1 items-center gap-2">
                                    <Avatar className="size-6 shrink-0">
                                      {foto && <AvatarImage src={foto} alt="" />}
                                      <AvatarFallback className="text-[9px]">
                                        {iniciaisDe(p.nome, p.email)}
                                      </AvatarFallback>
                                    </Avatar>
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium">
                                        {nome}
                                      </p>
                                      {nome !== p.email && (
                                        <p className="truncate text-xs text-muted-foreground">
                                          {p.email}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </PersonHoverCard>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  aria-label={rotuloRemover}
                                  onClick={() => {
                                    const restantes = escolhidos.filter(
                                      (item) => !mesmoEmail(item.email, p.email)
                                    );
                                    aplicar(restantes);
                                    if (restantes.length <= 3) {
                                      setTodosAbertos(false);
                                    }
                                  }}
                                >
                                  <XIcon />
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </PopoverContent>
                  </Popover>
                )}
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
