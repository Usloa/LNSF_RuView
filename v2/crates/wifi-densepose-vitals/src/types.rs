//! 生命体征领域类型（ADR-021）。

#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};

/// 生命体征测量的状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub enum VitalStatus {
    /// 有效测量，具备临床级置信度。
    Valid,
    /// 有测量结果，但置信度下降。
    Degraded,
    /// 测量不可靠（例如仅来自单一 RSSI 源）。
    Unreliable,
    /// 无法进行测量。
    Unavailable,
}

/// 单个生命体征估计值。
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct VitalEstimate {
    /// 估计值，单位为 BPM（每分钟心跳/呼吸次数）。
    pub value_bpm: f64,
    /// 该估计的置信度，取值 [0.0, 1.0]。
    pub confidence: f64,
    /// 测量状态。
    pub status: VitalStatus,
}

/// 合并后的生命体征读数。
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct VitalReading {
    /// 呼吸频率估计值。
    pub respiratory_rate: VitalEstimate,
    /// 心率估计值。
    pub heart_rate: VitalEstimate,
    /// 使用的子载波数量。
    pub subcarrier_count: usize,
    /// 信号质量评分，取值 [0.0, 1.0]。
    pub signal_quality: f64,
    /// 时间戳（自 Unix 纪元起的秒数）。
    pub timestamp_secs: f64,
}

/// 生命体征流水线的输入帧。
#[derive(Debug, Clone)]
pub struct CsiFrame {
    /// 逐子载波幅度。
    pub amplitudes: Vec<f64>,
    /// 逐子载波相位（弧度）。
    pub phases: Vec<f64>,
    /// 子载波数量。
    pub n_subcarriers: usize,
    /// 采样序号（单调递增）。
    pub sample_index: u64,
    /// 采样率，单位 Hz。
    pub sample_rate_hz: f64,
}

impl CsiFrame {
    /// 创建一帧 CSI，并校验幅度与相位向量长度与声明的子载波数一致。
    ///
    /// 若长度不一致则返回 `None`。
    pub fn new(
        amplitudes: Vec<f64>,
        phases: Vec<f64>,
        n_subcarriers: usize,
        sample_index: u64,
        sample_rate_hz: f64,
    ) -> Option<Self> {
        if amplitudes.len() != n_subcarriers || phases.len() != n_subcarriers {
            return None;
        }
        Some(Self {
            amplitudes,
            phases,
            n_subcarriers,
            sample_index,
            sample_rate_hz,
        })
    }
}

impl VitalEstimate {
    /// 创建一个不可用估计（无法测量）。
    pub fn unavailable() -> Self {
        Self {
            value_bpm: 0.0,
            confidence: 0.0,
            status: VitalStatus::Unavailable,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vital_status_equality() {
        assert_eq!(VitalStatus::Valid, VitalStatus::Valid);
        assert_ne!(VitalStatus::Valid, VitalStatus::Degraded);
    }

    #[test]
    fn vital_estimate_unavailable() {
        let est = VitalEstimate::unavailable();
        assert_eq!(est.status, VitalStatus::Unavailable);
        assert!((est.value_bpm - 0.0).abs() < f64::EPSILON);
        assert!((est.confidence - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn csi_frame_new_valid() {
        let frame = CsiFrame::new(vec![1.0, 2.0, 3.0], vec![0.1, 0.2, 0.3], 3, 0, 100.0);
        assert!(frame.is_some());
        let f = frame.unwrap();
        assert_eq!(f.n_subcarriers, 3);
        assert_eq!(f.amplitudes.len(), 3);
    }

    #[test]
    fn csi_frame_new_mismatched_lengths() {
        let frame = CsiFrame::new(vec![1.0, 2.0], vec![0.1, 0.2, 0.3], 3, 0, 100.0);
        assert!(frame.is_none());
    }

    #[test]
    fn csi_frame_clone() {
        let frame = CsiFrame::new(vec![1.0], vec![0.5], 1, 42, 50.0).unwrap();
        let cloned = frame.clone();
        assert_eq!(cloned.sample_index, 42);
        assert_eq!(cloned.n_subcarriers, 1);
    }

    #[cfg(feature = "serde")]
    #[test]
    fn vital_reading_serde_roundtrip() {
        let reading = VitalReading {
            respiratory_rate: VitalEstimate {
                value_bpm: 15.0,
                confidence: 0.9,
                status: VitalStatus::Valid,
            },
            heart_rate: VitalEstimate {
                value_bpm: 72.0,
                confidence: 0.85,
                status: VitalStatus::Valid,
            },
            subcarrier_count: 56,
            signal_quality: 0.92,
            timestamp_secs: 1_700_000_000.0,
        };
        let json = serde_json::to_string(&reading).unwrap();
        let parsed: VitalReading = serde_json::from_str(&json).unwrap();
        assert!((parsed.heart_rate.value_bpm - 72.0).abs() < f64::EPSILON);
    }
}
