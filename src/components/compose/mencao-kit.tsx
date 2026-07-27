"use client";

import * as React from "react";

import type { TComboboxInputElement, TMentionElement } from "platejs";
import type { PlateElementProps } from "platejs/react";
import { PlateElement } from "platejs/react";

import { getMentionOnSelectItem } from "@platejs/mention";
import { MentionInputPlugin, MentionPlugin } from "@platejs/mention/react";

import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxInput,
  InlineComboboxItem,
} from "@/components/ui/inline-combobox";
import { MentionElement } from "@/components/ui/mention-node";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useFotos } from "@/lib/fotos";
import { useIdioma } from "@/lib/idioma";
import type { Pessoa } from "@/lib/types";

/**
 * Menção com @ no corpo do e-mail (#106).
 *
 * Reaproveita **literalmente** o plugin de menção vendorizado do Plate
 * (`@platejs/mention` + `src/components/ui/mention-node.tsx` +
 * `src/components/ui/inline-combobox.tsx`) — só troca a **fonte dos itens**: em
 * vez da lista fixa de exemplo (Star Wars), o autocomplete lista os
 * destinatários ATUAIS de Para/Cc/Cco, cada um com **avatar + nome** (mesmo
 * padrão do #40: `Avatar` do reui + foto pelo cache do #39 via `useFotos`).
 *
 * Os destinatários chegam por contexto (`MencionaveisProvider`), alimentado pelo
 * compose a partir do que o usuário escolheu nos campos de destinatário. O nó de
 * menção inserido é o `MentionElement` padrão do Plate, com prefixo "@": ao ler
 * o corpo como HTML (innerHTML do `[data-slate-editor]`), a menção sai como um
 * `<span>@Nome</span>` — texto legível no e-mail final.
 */

const MencionaveisContext = React.createContext<Pessoa[]>([]);

export function MencionaveisProvider({
  pessoas,
  children,
}: {
  pessoas: Pessoa[];
  children: React.ReactNode;
}) {
  return (
    <MencionaveisContext.Provider value={pessoas}>
      {children}
    </MencionaveisContext.Provider>
  );
}

/** Iniciais do avatar: do nome quando há nome real, senão do e-mail. */
function iniciaisDe(nome: string, email: string): string {
  const base = nome && !nome.includes("@") ? nome : email.split("@")[0];
  const partes = base.split(/[\s._-]+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/**
 * Nó de menção renderizado no corpo. É o `MentionElement` padrão do Plate, só
 * com `prefix="@"` para exibir "@Nome" (e sair assim no HTML).
 */
function MencaoElement(props: PlateElementProps<TMentionElement>) {
  return <MentionElement {...props} prefix="@" />;
}

const onSelectItem = getMentionOnSelectItem();

/**
 * Input do combobox de menção: mesmo esqueleto do `MentionInputElement`
 * vendorizado, com os itens vindos dos destinatários (contexto) e cada linha
 * mostrando avatar + nome.
 */
function MencaoInputElement(props: PlateElementProps<TComboboxInputElement>) {
  const { editor, element } = props;
  const [search, setSearch] = React.useState("");
  const pessoas = React.useContext(MencionaveisContext);
  const { getFoto, pedirFotos } = useFotos();
  const { t } = useIdioma();
  const textos = t.controlRoom;

  React.useEffect(() => {
    if (pessoas.length > 0) pedirFotos(pessoas.map((p) => p.email));
  }, [pessoas, pedirFotos]);

  return (
    <PlateElement {...props} as="span">
      <InlineCombobox
        value={search}
        element={element}
        setValue={setSearch}
        showTrigger={false}
        trigger="@"
      >
        <span className="inline-block rounded-md bg-muted px-1.5 py-0.5 align-baseline text-sm ring-ring focus-within:ring-2">
          <InlineComboboxInput />
        </span>

        {/* `pointer-events-auto`: o compose é um Sheet MODAL (Radix Dialog), que
            trava `body { pointer-events: none }` enquanto aberto. O popup do
            combobox é portalado no body, então sem isto ele HERDA o `none` e o
            clique/hover "atravessa" — mesmo cuidado do autocomplete de
            destinatários (#40, `campo-pessoas.tsx`). */}
        <InlineComboboxContent className="pointer-events-auto my-1.5">
          <InlineComboboxEmpty>
            {textos.semDestinatariosMencao}
          </InlineComboboxEmpty>

          <InlineComboboxGroup>
            {pessoas.map((p) => {
              const foto = p.foto ?? getFoto(p.email);
              const nome = p.nome || p.email;
              return (
                <InlineComboboxItem
                  key={p.email.toLowerCase()}
                  value={p.email}
                  keywords={[nome]}
                  className="gap-2"
                  onClick={() =>
                    onSelectItem(editor, { key: p.email, text: nome }, search)
                  }
                >
                  <Avatar className="size-6">
                    {foto && <AvatarImage src={foto} alt="" />}
                    <AvatarFallback className="text-[10px]">
                      {iniciaisDe(p.nome, p.email)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{nome}</span>
                </InlineComboboxItem>
              );
            })}
          </InlineComboboxGroup>
        </InlineComboboxContent>
      </InlineCombobox>

      {props.children}
    </PlateElement>
  );
}

/**
 * Kit de menção do corpo: mesmos plugins do `MentionKit` vendorizado, só com o
 * input trocado para o do compose (destinatários + avatar) e o nó com "@".
 * Fica FORA do `COMPOSE_KIT` (compartilhado com o editor de templates, que não
 * tem destinatários) — só o compose o adiciona.
 */
export const MENCAO_KIT = [
  MentionPlugin.configure({
    options: {
      triggerPreviousCharPattern: /^$|^[\s"']$/,
    },
  }).withComponent(MencaoElement),
  MentionInputPlugin.withComponent(MencaoInputElement),
];
