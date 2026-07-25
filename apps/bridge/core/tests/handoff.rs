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
        location: None,
        field_updated_at: Default::default(),
    }
}

#[test]
fn pro_aac_idea_is_staged_from_its_own_format_for_daw_handoff() {
    // Idea metadata deliberately carries no account tier: Bridge must decide
    // from the Idea's AAC format even when it came from a Pro Library.
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
