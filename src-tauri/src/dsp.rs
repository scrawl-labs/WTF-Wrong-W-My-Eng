// dsp.rs
// 오디오 신호 처리 순수 함수 - 마이크 캡처(audio.rs)와 파일 디코딩(decode.rs)이 공유
//
// 핵심 Rust 개념:
// - 순수 함수: 입력만으로 출력이 결정되고 부작용이 없어 유닛 테스트가 쉬움

/// 스테레오(또는 멀티채널) → 모노 변환
/// 채널들의 평균값을 취함
pub fn to_mono(samples: &[f32], channels: u16) -> Vec<f32> {
    if channels == 1 {
        return samples.to_vec();
    }
    samples
        .chunks(channels as usize)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

/// 선형 보간 기반 리샘플링
/// from_rate → to_rate 로 변환
pub fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate {
        return samples.to_vec();
    }

    let ratio = from_rate as f64 / to_rate as f64;
    let output_len = (samples.len() as f64 / ratio) as usize;

    (0..output_len)
        .map(|i| {
            let src_pos = i as f64 * ratio;
            let floor = src_pos as usize;
            let ceil = (floor + 1).min(samples.len() - 1);
            let frac = (src_pos - floor as f64) as f32;
            samples[floor] * (1.0 - frac) + samples[ceil] * frac
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_mono_averages_stereo_frames() {
        // L=1.0,R=3.0 → 평균 2.0 / L=0.0,R=0.0 → 평균 0.0
        let stereo = vec![1.0, 3.0, 0.0, 0.0];
        assert_eq!(to_mono(&stereo, 2), vec![2.0, 0.0]);
    }

    #[test]
    fn to_mono_passthrough_when_already_mono() {
        let mono = vec![0.5, -0.5, 0.25];
        assert_eq!(to_mono(&mono, 1), mono);
    }

    #[test]
    fn resample_passthrough_when_rates_match() {
        let samples = vec![0.1, 0.2, 0.3];
        assert_eq!(resample(&samples, 16_000, 16_000), samples);
    }

    #[test]
    fn resample_halves_length_when_downsampling_by_half() {
        // 48000Hz → 16000Hz는 1/3 길이가 되어야 함 (48000/16000 = 3)
        let samples: Vec<f32> = (0..300).map(|i| i as f32).collect();
        let out = resample(&samples, 48_000, 16_000);
        assert_eq!(out.len(), 100);
    }
}
