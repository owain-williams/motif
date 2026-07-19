//! Runtime codec adapter for DAW handoff.
//!
//! Bridge stores Free/Basic Ideas as AAC in an M4A container. This module
//! decodes one received file and atomically stages a 16-bit PCM WAV. Format
//! selection stays in `bridge-core`; only codec and filesystem mechanics live
//! here.

use std::fs::{self, File};
use std::path::Path;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub(crate) fn transcode_to_wav(source: &Path, destination: &Path) -> Result<(), String> {
    let input = File::open(source).map_err(|error| error.to_string())?;
    let stream = MediaSourceStream::new(Box::new(input), Default::default());
    let mut hint = Hint::new();
    hint.with_extension("m4a");
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| format!("Could not read compressed audio: {error}"))?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .filter(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "Compressed audio has no decodable track".to_string())?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|error| format!("Could not decode compressed audio: {error}"))?;

    let temporary = destination.with_extension("wav.partial");
    let result = (|| -> Result<(), String> {
        let mut writer = None;
        loop {
            let packet = match format.next_packet() {
                Ok(packet) => packet,
                Err(SymphoniaError::IoError(error))
                    if error.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    break
                }
                Err(error) => return Err(format!("Could not read audio packet: {error}")),
            };
            if packet.track_id() != track_id {
                continue;
            }
            let decoded = match decoder.decode(&packet) {
                Ok(decoded) => decoded,
                Err(SymphoniaError::DecodeError(_)) => continue,
                Err(error) => return Err(format!("Could not decode audio packet: {error}")),
            };
            let decoded_spec = *decoded.spec();
            if writer.is_none() {
                let spec = hound::WavSpec {
                    channels: decoded_spec.channels.count() as u16,
                    sample_rate: decoded_spec.rate,
                    bits_per_sample: 16,
                    sample_format: hound::SampleFormat::Int,
                };
                writer = Some(
                    hound::WavWriter::create(&temporary, spec)
                        .map_err(|error| format!("Could not create WAV: {error}"))?,
                );
            }
            let mut samples = SampleBuffer::<i16>::new(decoded.capacity() as u64, decoded_spec);
            samples.copy_interleaved_ref(decoded);
            for sample in samples.samples() {
                writer
                    .as_mut()
                    .expect("writer exists after the first decoded packet")
                    .write_sample(*sample)
                    .map_err(|error| format!("Could not write WAV: {error}"))?;
            }
        }
        writer
            .ok_or_else(|| "Compressed audio contained no samples".to_string())?
            .finalize()
            .map_err(|error| format!("Could not finish WAV: {error}"))?;
        fs::rename(&temporary, destination).map_err(|error| error.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::transcode_to_wav;

    #[test]
    fn compressed_handoff_is_a_readable_pcm_wav() {
        let source = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/tone.m4a");
        let destination = std::env::temp_dir().join(format!(
            "motif-handoff-{}-{}.wav",
            std::process::id(),
            std::thread::current().name().unwrap_or("test")
        ));

        transcode_to_wav(&source, &destination).expect("transcode fixture");
        let mut wav = hound::WavReader::open(&destination).expect("open staged WAV");
        assert_eq!(wav.spec().channels, 1);
        assert_eq!(wav.spec().sample_rate, 44_100);
        assert_eq!(wav.spec().bits_per_sample, 16);
        assert!(wav.samples::<i16>().next().is_some());

        let _ = std::fs::remove_file(destination);
    }
}
