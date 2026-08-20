// #1020: `copyText` num `.ts` proprio, nao no `people-shared.tsx`.
//
// A regra `react(only-export-components)` dispara quando um arquivo exporta
// componentes E nao-componentes juntos — foi o que aconteceu ao juntar este
// helper com os badges compartilhados. Mesma licao do #1324: funcao pura mora
// em modulo puro. E aqui ela tambem nao precisa de React nenhum.
export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  }
}
