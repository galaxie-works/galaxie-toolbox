import type { EventoAgenda, EventoDetalhe } from "./types";

type EventoComOrganizador = Pick<
  EventoAgenda | EventoDetalhe,
  "souOrganizador" | "resposta"
>;

/**
 * O Graph expõe a autoria tanto em `isOrganizer` (`souOrganizador`) quanto no
 * `responseStatus=organizer`. Ambos identificam um evento que o usuário pode
 * editar ou remover; convidados ficam restritos ao RSVP (#287).
 */
export function podeGerenciarEvento(
  evento: EventoComOrganizador | null | undefined,
): boolean {
  return !!evento && (evento.souOrganizador || evento.resposta === "organizer");
}
