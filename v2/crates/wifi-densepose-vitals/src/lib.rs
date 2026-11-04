//! ESP32 CSI 级生命体征提取（ADR-021）。
//!
//! 从 WiFi 信道状态信息中，通过多子载波幅度与相位分析，
//! 提取心率与呼吸频率。
//!
//! # 架构
//!
//! 流水线分四个阶段处理 CSI 帧：
//!
//! 1. **预处理**（[`CsiVitalPreprocessor`]）：基于 EMA 的静态分量抑制，
//!    产出逐子载波残差。
//! 2. **呼吸提取**（[`BreathingExtractor`]）：0.1–0.5 Hz 带通滤波，
//!    通过过零分析得到呼吸频率。
//! 3. **心率提取**（[`HeartRateExtractor`]）：0.8–2.0 Hz 带通滤波，
//!    采用自相关峰值检测，并按子载波间相位一致性加权。
//! 4. **异常检测**（[`VitalAnomalyDetector`]）：Z 分数分析，
//!    结合 Welford 滑动统计产生临床告警（呼吸暂停、心动过速、心动过缓）。
//!
//! 结果存入 [`VitalSignStore`]，保留时长可配置，供历史分析使用。
//!
//! 真值评估（[`groundtruth`]，ADR-293）读取参考设备序列（CSV 导出），
//! 与 store 中的会话做时间对齐，并产出带证据等级的一致性统计
//! （MAE/RMSE/偏差、Bland-Altman 界限、容差内百分比），
//! 且必须指定会话范围。
//!
//! # 示例
//!
//! ```
//! use wifi_densepose_vitals::{
//!     CsiVitalPreprocessor, BreathingExtractor, HeartRateExtractor,
//!     VitalAnomalyDetector, VitalSignStore, CsiFrame,
//!     VitalReading, VitalEstimate, VitalStatus,
//! };
//!
//! let mut preprocessor = CsiVitalPreprocessor::new(56, 0.05);
//! let mut breathing = BreathingExtractor::new(56, 100.0, 30.0);
//! let mut heartrate = HeartRateExtractor::new(56, 100.0, 15.0);
//! let mut anomaly = VitalAnomalyDetector::default_config();
//! let mut store = VitalSignStore::new(3600);
//!
//! // 处理一帧 CSI
//! let frame = CsiFrame {
//!     amplitudes: vec![1.0; 56],
//!     phases: vec![0.0; 56],
//!     n_subcarriers: 56,
//!     sample_index: 0,
//!     sample_rate_hz: 100.0,
//! };
//!
//! if let Some(residuals) = preprocessor.process(&frame) {
//!     let weights = vec![1.0 / 56.0; 56];
//!     let rr = breathing.extract(&residuals, &weights);
//!     let hr = heartrate.extract(&residuals, &frame.phases);
//!
//!     let reading = VitalReading {
//!         respiratory_rate: rr.unwrap_or_else(VitalEstimate::unavailable),
//!         heart_rate: hr.unwrap_or_else(VitalEstimate::unavailable),
//!         subcarrier_count: frame.n_subcarriers,
//!         signal_quality: 0.9,
//!         timestamp_secs: 0.0,
//!     };
//!
//!     let alerts = anomaly.check(&reading);
//!     store.push(reading);
//! }
//! ```

pub mod anomaly;
pub mod breathing;
pub mod groundtruth;
pub mod heartrate;
pub mod preprocessor;
pub mod store;
pub mod types;

pub use anomaly::{AnomalyAlert, VitalAnomalyDetector};
pub use breathing::BreathingExtractor;
pub use groundtruth::{
    align, evaluate_session, AgreementConfig, AgreementReport, AlignmentConfig, AlignmentResult,
    DistanceBand, DriftFit, EstimateSeries, EvidenceGrade, GradedAgreementReport,
    GroundTruthError, Measurand, MeasurementPrinciple, MotionState, Propagation, ReferenceDevice,
    ReferenceSample, ReferenceSeries, SessionEvaluation, SessionScope,
};
pub use heartrate::HeartRateExtractor;
pub use preprocessor::CsiVitalPreprocessor;
pub use store::{VitalSignStore, VitalStats};
pub use types::{CsiFrame, VitalEstimate, VitalReading, VitalStatus};
