use galaxie_remote_system_agent::{AgentArgs, AgentError};

fn main() -> Result<(), AgentError> {
    let args = AgentArgs::parse(std::env::args().skip(1))?;
    #[cfg(windows)]
    {
        galaxie_remote_system_agent::windows_runtime::run(&args)
    }
    #[cfg(not(windows))]
    {
        let _ = args;
        Err(AgentError::Windows("Windows-only worker".into()))
    }
}
