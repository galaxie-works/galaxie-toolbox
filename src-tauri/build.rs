fn main() {
  // #387 follow-up: a config de telemetria é embutida em compile-time via
  // `option_env!` no telemetry.rs. Sem isto, o cargo cacheia o crate e não
  // reembute quando só o valor da env muda (sem mudança de fonte). Em runner
  // de release (checkout limpo) é non-issue, mas mantém o build honesto.
  for var in [
    "GALAXIE_TELEMETRY_OTLP_ENDPOINT",
    "GALAXIE_TELEMETRY_STREAM_NAME",
    "GALAXIE_TELEMETRY_INGEST_EMAIL",
    "GALAXIE_TELEMETRY_INGEST_TOKEN",
    "GOOGLE_CLIENT_SECRET",
  ] {
    println!("cargo:rerun-if-env-changed={var}");
  }
  tauri_build::build()
}
