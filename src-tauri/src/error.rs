//! Gestion d'erreurs de Foxmark.
//!
//! Toutes les commands renvoient `Result<T, Error>` ; l'erreur est
//! sérialisée en chaîne lisible, affichée côté UI dans un toast.

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Erreur d'entrée/sortie : {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Message(String),
}

impl Error {
    /// Erreur libre avec un message destiné à l'utilisateur.
    pub fn msg(message: impl Into<String>) -> Self {
        Error::Message(message.into())
    }
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
