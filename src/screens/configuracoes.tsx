import { TemplatesEmail } from "@/components/templates-email";
import { NotificacoesSettings } from "@/components/notificacoes-settings";
import { useIdioma } from "@/lib/idioma";

/**
 * Preferências do app. Hoje só os templates de e-mail (#93); é aqui que as
 * demais preferências locais (assinatura etc.) devem entrar quando saírem do
 * localStorage cru.
 */
export function ConfiguracoesScreen() {
  const { t } = useIdioma();

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-muted-foreground">{t.configuracoes.descricao}</p>
      <NotificacoesSettings />
      <TemplatesEmail />
    </div>
  );
}
