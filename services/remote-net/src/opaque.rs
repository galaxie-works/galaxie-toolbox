use argon2::Argon2;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use opaque_ke::ciphersuite::CipherSuite;
use opaque_ke::key_exchange::tripledh::TripleDh;
use opaque_ke::rand::rngs::OsRng;
use opaque_ke::{
    ClientLogin, ClientLoginFinishParameters, ClientRegistration,
    ClientRegistrationFinishParameters, CredentialFinalization, CredentialRequest,
    CredentialResponse, RegistrationRequest, RegistrationResponse, RegistrationUpload, ServerLogin,
    ServerLoginStartParameters, ServerRegistration, ServerSetup,
};
use zeroize::{Zeroize, Zeroizing};

pub struct GalaxieOpaque;

impl CipherSuite for GalaxieOpaque {
    type OprfCs = opaque_ke::Ristretto255;
    type KeGroup = opaque_ke::Ristretto255;
    type KeyExchange = TripleDh;
    type Ksf = Argon2<'static>;
}

type Setup = ServerSetup<GalaxieOpaque>;
type Registration = ServerRegistration<GalaxieOpaque>;

#[derive(Debug, thiserror::Error)]
pub enum OpaqueError {
    #[error("OPAQUE message encoding is invalid")]
    Encoding,
    #[error("OPAQUE protocol failed")]
    Protocol,
}

pub struct ServerSecrets(Setup);

impl ServerSecrets {
    pub fn generate() -> Self {
        Self(Setup::new(&mut OsRng))
    }

    pub fn serialize(&self) -> Zeroizing<Vec<u8>> {
        Zeroizing::new(self.0.serialize().to_vec())
    }

    pub fn deserialize(bytes: &[u8]) -> Result<Self, OpaqueError> {
        Setup::deserialize(bytes)
            .map(Self)
            .map_err(|_| OpaqueError::Encoding)
    }
}

pub struct ClientRegistrationFlow {
    state: ClientRegistration<GalaxieOpaque>,
    password: Zeroizing<Vec<u8>>,
}

impl ClientRegistrationFlow {
    pub fn start(password: &[u8]) -> Result<(Self, String), OpaqueError> {
        let result = ClientRegistration::<GalaxieOpaque>::start(&mut OsRng, password)
            .map_err(|_| OpaqueError::Protocol)?;
        Ok((
            Self {
                state: result.state,
                password: Zeroizing::new(password.to_vec()),
            },
            STANDARD.encode(result.message.serialize()),
        ))
    }

    pub fn finish(mut self, response: &str) -> Result<RegistrationFinish, OpaqueError> {
        let response = decode::<RegistrationResponse<GalaxieOpaque>>(response)?;
        let result = self
            .state
            .finish(
                &mut OsRng,
                &self.password,
                response,
                ClientRegistrationFinishParameters::default(),
            )
            .map_err(|_| OpaqueError::Protocol)?;
        self.password.zeroize();
        Ok(RegistrationFinish {
            upload: STANDARD.encode(result.message.serialize()),
            export_key: Zeroizing::new(result.export_key.to_vec()),
        })
    }
}

pub struct RegistrationFinish {
    pub upload: String,
    pub export_key: Zeroizing<Vec<u8>>,
}

pub fn server_registration_start(
    setup: &ServerSecrets,
    account_id: &[u8],
    request: &str,
) -> Result<String, OpaqueError> {
    let request = decode::<RegistrationRequest<GalaxieOpaque>>(request)?;
    let result =
        Registration::start(&setup.0, request, account_id).map_err(|_| OpaqueError::Protocol)?;
    Ok(STANDARD.encode(result.message.serialize()))
}

pub fn server_registration_finish(upload: &str) -> Result<Vec<u8>, OpaqueError> {
    let upload = decode::<RegistrationUpload<GalaxieOpaque>>(upload)?;
    Ok(Registration::finish(upload).serialize().to_vec())
}

pub struct ClientLoginFlow {
    state: ClientLogin<GalaxieOpaque>,
    password: Zeroizing<Vec<u8>>,
}

impl ClientLoginFlow {
    pub fn start(password: &[u8]) -> Result<(Self, String), OpaqueError> {
        let result = ClientLogin::<GalaxieOpaque>::start(&mut OsRng, password)
            .map_err(|_| OpaqueError::Protocol)?;
        Ok((
            Self {
                state: result.state,
                password: Zeroizing::new(password.to_vec()),
            },
            STANDARD.encode(result.message.serialize()),
        ))
    }

    pub fn finish(mut self, response: &str) -> Result<LoginFinish, OpaqueError> {
        let response = decode::<CredentialResponse<GalaxieOpaque>>(response)?;
        let result = self
            .state
            .finish(
                &self.password,
                response,
                ClientLoginFinishParameters::default(),
            )
            .map_err(|_| OpaqueError::Protocol)?;
        self.password.zeroize();
        Ok(LoginFinish {
            finalization: STANDARD.encode(result.message.serialize()),
            session_key: Zeroizing::new(result.session_key.to_vec()),
        })
    }
}

pub struct LoginFinish {
    pub finalization: String,
    pub session_key: Zeroizing<Vec<u8>>,
}

pub struct ServerLoginFlow {
    state: ServerLogin<GalaxieOpaque>,
}

impl ServerLoginFlow {
    pub fn start(
        setup: &ServerSecrets,
        account_id: &[u8],
        password_file: &[u8],
        request: &str,
    ) -> Result<(Self, String), OpaqueError> {
        let password_file =
            Registration::deserialize(password_file).map_err(|_| OpaqueError::Encoding)?;
        let request = decode::<CredentialRequest<GalaxieOpaque>>(request)?;
        let result = ServerLogin::start(
            &mut OsRng,
            &setup.0,
            Some(password_file),
            request,
            account_id,
            ServerLoginStartParameters::default(),
        )
        .map_err(|_| OpaqueError::Protocol)?;
        Ok((
            Self {
                state: result.state,
            },
            STANDARD.encode(result.message.serialize()),
        ))
    }

    pub fn finish(self, finalization: &str) -> Result<Zeroizing<Vec<u8>>, OpaqueError> {
        let finalization = decode::<CredentialFinalization<GalaxieOpaque>>(finalization)?;
        let result = self
            .state
            .finish(finalization)
            .map_err(|_| OpaqueError::Protocol)?;
        Ok(Zeroizing::new(result.session_key.to_vec()))
    }
}

trait WireMessage: Sized {
    fn deserialize(bytes: &[u8]) -> Result<Self, opaque_ke::errors::ProtocolError>;
}

macro_rules! wire_message {
    ($($ty:ty),+ $(,)?) => {
        $(impl WireMessage for $ty {
            fn deserialize(bytes: &[u8]) -> Result<Self, opaque_ke::errors::ProtocolError> {
                <$ty>::deserialize(bytes)
            }
        })+
    };
}

wire_message!(
    RegistrationRequest<GalaxieOpaque>,
    RegistrationResponse<GalaxieOpaque>,
    RegistrationUpload<GalaxieOpaque>,
    CredentialRequest<GalaxieOpaque>,
    CredentialResponse<GalaxieOpaque>,
    CredentialFinalization<GalaxieOpaque>,
);

fn decode<T: WireMessage>(value: &str) -> Result<T, OpaqueError> {
    let bytes = STANDARD.decode(value).map_err(|_| OpaqueError::Encoding)?;
    T::deserialize(&bytes).map_err(|_| OpaqueError::Encoding)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registration_and_login_agree_on_session_key() {
        let setup = ServerSecrets::generate();
        let password = Zeroizing::new(b"correct horse battery staple".to_vec());
        let account = b"org-1/device-1";

        let (client_registration, request) = ClientRegistrationFlow::start(&password).unwrap();
        let response = server_registration_start(&setup, account, &request).unwrap();
        let registration = client_registration.finish(&response).unwrap();
        let password_file = server_registration_finish(&registration.upload).unwrap();

        let (client_login, request) = ClientLoginFlow::start(&password).unwrap();
        let (server_login, response) =
            ServerLoginFlow::start(&setup, account, &password_file, &request).unwrap();
        let client_finish = client_login.finish(&response).unwrap();
        let server_key = server_login.finish(&client_finish.finalization).unwrap();
        assert_eq!(&*client_finish.session_key, &*server_key);
    }

    #[test]
    fn wrong_password_fails() {
        let setup = ServerSecrets::generate();
        let account = b"org-1/device-1";
        let (registration, request) = ClientRegistrationFlow::start(b"right").unwrap();
        let response = server_registration_start(&setup, account, &request).unwrap();
        let registration = registration.finish(&response).unwrap();
        let password_file = server_registration_finish(&registration.upload).unwrap();

        let (login, request) = ClientLoginFlow::start(b"wrong").unwrap();
        let (_, response) =
            ServerLoginFlow::start(&setup, account, &password_file, &request).unwrap();
        assert!(login.finish(&response).is_err());
    }

    #[test]
    fn server_setup_round_trips() {
        let setup = ServerSecrets::generate();
        assert!(ServerSecrets::deserialize(&setup.serialize()).is_ok());
    }
}
