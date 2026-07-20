use std::path::{Path, PathBuf};

use bridge_core::{plan_handoff, AudioFormat, HandoffPlan, IdeaMetadata, IdeaStorageState};

fn idea(format: AudioFormat) -> IdeaMetadata {
    IdeaMetadata {
        id: "idea-42".into(),
        name: "Late night riff".into(),
        captured_at: 1_700_000_000_000,
        duration_ms: 4_200,
        audio_format: format,
        channels: 1,
        storage_state: IdeaStorageState::OnDevice,
        tags: Vec::new(),
        instrument: Vec::new(),
        style: Vec::new(),
        tempo: None,
        field_updated_at: Default::default(),
    }
}

#[test]
fn compressed_idea_is_staged_as_wav_for_daw_handoff() {
    let plan = plan_handoff(
        &idea(AudioFormat::Aac),
        Path::new("/library/ideas/idea-42.m4a"),
        Path::new("/cache/handoffs"),
    );

    assert_eq!(
        plan,
        HandoffPlan::TranscodeToWav {
            source: PathBuf::from("/library/ideas/idea-42.m4a"),
            destination: PathBuf::from("/cache/handoffs/idea-42.wav"),
        }
    );
}

#[test]
fn wav_idea_is_handed_off_from_its_original_file() {
    let source = Path::new("/library/ideas/idea-42.wav");

    assert_eq!(
        plan_handoff(
            &idea(AudioFormat::Wav),
            source,
            Path::new("/cache/handoffs"),
        ),
        HandoffPlan::UseOriginal(source.to_path_buf()),
    );
}
