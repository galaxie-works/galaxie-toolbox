import * as api from "../lib/api.ts";

import type {
  AppPersistido,
  ConfigBackend,
  ConfigSnapshot,
} from "./config-backend";

/**
 * Grupo A do épico #556. Estado de sessão/cache visual e Organizations (#560)
 * ficam deliberadamente fora desta lista.
 */
export const CHAVES_CONFIG_NUVEM = [
  "zoom",
  "sidebarAberta",
  "marcarLidoModo",
  "marcarLidoAtraso",
  "peopleTab",
  "ordenar",
  "ordemDesc",
  "filtros",
  "agruparConversas",
  "caixasCompartilhadas",
  "notificacoes",
  "fundoAnimado",
  "modoTema",
  "temaVisual",
  "altoContraste",
  "assinaturas",
  "assinaturaPadraoId",
  "templates",
  "undoSendDelayMs",
  "syncIntervalMinutes",
  "agendaView",
  "agendaCalendariosSelecionados",
  "idioma",
  "atomsPrefs",
  "pularConfirmacaoConexao",
] as const satisfies readonly (keyof AppPersistido)[];

export function projetarConfigNuvem(
  state: Partial<AppPersistido>,
): Partial<AppPersistido> {
  const cloud: Partial<AppPersistido> = {};
  for (const key of CHAVES_CONFIG_NUVEM) {
    if (state[key] !== undefined) {
      Object.assign(cloud, { [key]: state[key] });
    }
  }
  return cloud;
}

interface OneDriveSettingsPort {
  read(): Promise<string | null>;
  write(content: string): Promise<void>;
}

const apiPort: OneDriveSettingsPort = {
  read: api.onedriveSettingsRead,
  write: api.onedriveSettingsWrite,
};

/** Arquivo privado do usuário no OneDrive; nunca cria link compartilhável. */
export class OneDriveJsonBackend implements ConfigBackend {
  private readonly port: OneDriveSettingsPort;

  constructor(port: OneDriveSettingsPort = apiPort) {
    this.port = port;
  }

  async load(): Promise<Partial<AppPersistido>> {
    const raw = await this.port.read();
    if (raw === null || raw.trim() === "") return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("toolbox.json não contém um objeto de configuração");
    }
    return projetarConfigNuvem(parsed as Partial<AppPersistido>);
  }

  async save(patch: Partial<AppPersistido>): Promise<void> {
    await this.port.write(JSON.stringify(projetarConfigNuvem(patch)));
  }

  async clear(): Promise<void> {
    await this.port.write("{}");
  }
}

type LocalConfigBackend = ConfigBackend & ConfigSnapshot;

export interface LayeredBackendOptions {
  debounceMs?: number;
  onCloudError?: (error: unknown) => void;
  baseline?: () => Partial<AppPersistido>;
}

/**
 * Cache local síncrono + autoridade cloud assíncrona. A S2 (#559) acrescentará
 * eTag, merge LWW e fila offline; aqui o último snapshot completo é debounced.
 */
export class LayeredBackend implements ConfigBackend, ConfigSnapshot {
  private active = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Partial<AppPersistido> | null = null;
  private readonly debounceMs: number;
  private readonly onCloudError: (error: unknown) => void;
  private readonly baseline: () => Partial<AppPersistido>;
  private readonly local: LocalConfigBackend;
  private readonly cloud: ConfigBackend;

  constructor(
    local: LocalConfigBackend,
    cloud: ConfigBackend,
    options: LayeredBackendOptions = {},
  ) {
    this.local = local;
    this.cloud = cloud;
    this.debounceMs = options.debounceMs ?? 750;
    this.onCloudError = options.onCloudError ?? (() => undefined);
    this.baseline = options.baseline ?? (() => ({}));
  }

  getSnapshot(): Partial<AppPersistido> {
    return this.local.getSnapshot();
  }

  activate(): void {
    this.active = true;
  }

  deactivate(): void {
    this.active = false;
    this.pending = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  async load(): Promise<Partial<AppPersistido>> {
    const local = {
      ...projetarConfigNuvem(this.baseline()),
      ...projetarConfigNuvem(this.local.getSnapshot()),
    };
    const remote = projetarConfigNuvem(await this.cloud.load());
    const merged = { ...local, ...remote };

    await this.local.save(merged);
    const normalized = {
      ...projetarConfigNuvem(this.baseline()),
      ...projetarConfigNuvem(this.local.getSnapshot()),
    };
    // Arquivo ausente/vazio e schema antigo recebem o snapshot completo atual.
    if (JSON.stringify(remote) !== JSON.stringify(normalized)) {
      await this.cloud.save(normalized);
    }
    return normalized;
  }

  async save(patch: Partial<AppPersistido>): Promise<void> {
    await this.local.save(patch);
    if (!this.active) return;
    this.pending = {
      ...projetarConfigNuvem(this.baseline()),
      ...projetarConfigNuvem(this.local.getSnapshot()),
    };
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(this.onCloudError);
    }, this.debounceMs);
  }

  async flush(): Promise<void> {
    if (!this.active || this.pending === null) return;
    const snapshot = this.pending;
    this.pending = null;
    await this.cloud.save(snapshot);
  }

  /** Limpar o cache nunca apaga a autoridade cloud do usuário. */
  async clear(): Promise<void> {
    this.deactivate();
    await this.local.clear();
  }
}
