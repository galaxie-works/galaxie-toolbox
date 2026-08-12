//! Normalização de access units H.264 na borda S1→S2.

const START_CODE: &[u8; 4] = &[0, 0, 0, 1];

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum AnnexBError {
    #[error("access unit H.264 vazia")]
    Empty,
    #[error("AVCC inválido: comprimento do NAL excede o buffer")]
    TruncatedAvccNal,
    #[error("access unit não contém NAL H.264")]
    NoNalUnits,
    #[error("IDR sem SPS/PPS disponíveis")]
    MissingParameterSets,
}

#[derive(Debug, Clone, Default)]
pub struct AnnexBNormalizer {
    sps: Option<Vec<u8>>,
    pps: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedAccessUnit {
    pub data: Vec<u8>,
    pub keyframe: bool,
}

impl AnnexBNormalizer {
    pub fn normalize(&mut self, bytes: &[u8]) -> Result<NormalizedAccessUnit, AnnexBError> {
        if bytes.is_empty() {
            return Err(AnnexBError::Empty);
        }

        let annex_b = if starts_with_start_code(bytes) {
            canonicalize_annex_b(bytes)
        } else {
            avcc_to_annex_b(bytes)?
        };

        let units = split_annex_b(&annex_b);
        if units.is_empty() {
            return Err(AnnexBError::NoNalUnits);
        }

        let mut keyframe = false;
        let mut has_sps = false;
        let mut has_pps = false;
        for nal in &units {
            match nal_type(nal) {
                5 => keyframe = true,
                7 => {
                    self.sps = Some(with_start_code(nal));
                    has_sps = true;
                }
                8 => {
                    self.pps = Some(with_start_code(nal));
                    has_pps = true;
                }
                _ => {}
            }
        }

        if keyframe && (!has_sps || !has_pps) {
            if (!has_sps && self.sps.is_none()) || (!has_pps && self.pps.is_none()) {
                return Err(AnnexBError::MissingParameterSets);
            }
            let mut prefixed = Vec::with_capacity(
                self.sps.as_ref().map_or(0, Vec::len)
                    + self.pps.as_ref().map_or(0, Vec::len)
                    + annex_b.len(),
            );
            if !has_sps && let Some(sps) = &self.sps {
                prefixed.extend_from_slice(sps);
            }
            if !has_pps && let Some(pps) = &self.pps {
                prefixed.extend_from_slice(pps);
            }
            prefixed.extend_from_slice(&annex_b);
            return Ok(NormalizedAccessUnit {
                data: prefixed,
                keyframe,
            });
        }

        Ok(NormalizedAccessUnit {
            data: annex_b,
            keyframe,
        })
    }
}

fn starts_with_start_code(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0, 0, 1]) || bytes.starts_with(START_CODE)
}

fn canonicalize_annex_b(bytes: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(bytes.len() + 4);
    for unit in split_annex_b(bytes) {
        output.extend_from_slice(START_CODE);
        output.extend_from_slice(unit);
    }
    output
}

fn avcc_to_annex_b(bytes: &[u8]) -> Result<Vec<u8>, AnnexBError> {
    let mut cursor = 0usize;
    let mut output = Vec::with_capacity(bytes.len() + 16);
    while cursor < bytes.len() {
        if bytes.len() - cursor < 4 {
            return Err(AnnexBError::TruncatedAvccNal);
        }
        let length = u32::from_be_bytes([
            bytes[cursor],
            bytes[cursor + 1],
            bytes[cursor + 2],
            bytes[cursor + 3],
        ]) as usize;
        cursor += 4;
        if length == 0
            || cursor
                .checked_add(length)
                .is_none_or(|end| end > bytes.len())
        {
            return Err(AnnexBError::TruncatedAvccNal);
        }
        output.extend_from_slice(START_CODE);
        output.extend_from_slice(&bytes[cursor..cursor + length]);
        cursor += length;
    }
    if output.is_empty() {
        return Err(AnnexBError::NoNalUnits);
    }
    Ok(output)
}

fn split_annex_b(bytes: &[u8]) -> Vec<&[u8]> {
    let mut starts = Vec::new();
    let mut index = 0usize;
    while index + 3 <= bytes.len() {
        let code_length = if index + 4 <= bytes.len() && bytes[index..index + 4] == *START_CODE {
            Some(4)
        } else if bytes[index..index + 3] == [0, 0, 1] {
            Some(3)
        } else {
            None
        };
        if let Some(length) = code_length {
            starts.push((index, length));
            index += length;
        } else {
            index += 1;
        }
    }

    starts
        .iter()
        .enumerate()
        .filter_map(|(position, (start, code_length))| {
            let data_start = start + code_length;
            let data_end = starts
                .get(position + 1)
                .map_or(bytes.len(), |(next, _)| *next);
            (data_start < data_end).then_some(&bytes[data_start..data_end])
        })
        .collect()
}

fn nal_type(nal: &[u8]) -> u8 {
    nal.first().map_or(0, |header| header & 0x1f)
}

fn with_start_code(nal: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(START_CODE.len() + nal.len());
    output.extend_from_slice(START_CODE);
    output.extend_from_slice(nal);
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_avcc_to_canonical_annex_b() {
        let mut normalizer = AnnexBNormalizer::default();
        let avcc = [0, 0, 0, 2, 0x67, 1, 0, 0, 0, 2, 0x68, 2];
        let output = normalizer.normalize(&avcc).expect("valid AVCC");
        assert_eq!(output.data, [0, 0, 0, 1, 0x67, 1, 0, 0, 0, 1, 0x68, 2]);
        assert!(!output.keyframe);
    }

    #[test]
    fn prefixes_cached_parameter_sets_on_idr() {
        let mut normalizer = AnnexBNormalizer::default();
        normalizer
            .normalize(&[0, 0, 0, 1, 0x67, 1, 0, 0, 1, 0x68, 2])
            .expect("parameter sets");
        let output = normalizer.normalize(&[0, 0, 1, 0x65, 9, 9]).expect("IDR");
        assert!(output.keyframe);
        assert_eq!(
            output.data,
            [
                0, 0, 0, 1, 0x67, 1, 0, 0, 0, 1, 0x68, 2, 0, 0, 0, 1, 0x65, 9, 9,
            ]
        );
    }

    #[test]
    fn rejects_truncated_avcc() {
        let mut normalizer = AnnexBNormalizer::default();
        assert_eq!(
            normalizer.normalize(&[0, 0, 0, 5, 0x65]),
            Err(AnnexBError::TruncatedAvccNal)
        );
    }

    #[test]
    fn rejects_idr_before_parameter_sets_are_known() {
        let mut normalizer = AnnexBNormalizer::default();
        assert_eq!(
            normalizer.normalize(&[0, 0, 0, 1, 0x65, 1]),
            Err(AnnexBError::MissingParameterSets)
        );
    }
}
