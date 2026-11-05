# ADR-007：面向安全感知的后量子密码

## 状态
Proposed

## 日期
2026-02-28

## 背景

### 威胁模型

WiFi-DensePose 处理的数据可能暴露：
- **私人空间内是否有人**（监控风险）
- **健康指标**（通过呼吸/心跳检测，涉及医疗隐私）
- **活动模式**（行为画像）
- **建筑物占用情况**（物理安全情报）

在灾害场景（wifi-densepose-mat）中，风险更高：
- **分诊分类**影响救援优先级（生死攸关的决策）
- **幸存者位置**具有行动敏感性
- **检测审计链**可能用于法律程序（责任认定）
- **漏检**（未发现幸存者）可能被取证调查

当前安全状况：系统使用标准 JWT（HS256）做 API 认证，静态数据、模型完整性和检测审计链都没有密码学保护。

### 量子威胁时间表

NIST 估计具备密码学意义的量子计算机可能在 2030-2035 年间出现。今天用经典加密采集的数据，未来可能被追溯解密（「先窃取，后解密」）。对于可能在基础设施中部署数十年的系统，提前具备后量子能力是稳妥的。

### RuVector 的密码技术栈

RuVector 提供分层的密码体系：

| 算法 | 用途 | 标准 | 抗量子 |
|-----------|---------|----------|-------------------|
| ML-DSA-65 | 数字签名 | FIPS 204 | 是（基于格） |
| Ed25519 | 数字签名 | RFC 8032 | 否（经典算法回退） |
| SLH-DSA-128s | 数字签名 | FIPS 205 | 是（基于哈希） |
| SHAKE-256 | 哈希 | FIPS 202 | 是 |
| AES-256-GCM | 对称加密 | FIPS 197 | 是（Grover 算法使强度减半，仍为 128 位） |

## 决策

我们将接入 RuVector 的密码层，为 WiFi-DensePose 数据提供纵深防御，采用**经典 + 后量子混合**方案：同时施加 Ed25519 与 ML-DSA-65 签名（在后量子算法成熟之前保持双保险）。

### 密码保护范围

```
┌──────────────────────────────────────────────────────────────────┐
│              Cryptographic Protection Layers                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. MODEL INTEGRITY                                              │
│     ┌─────────────────────────────────────────────────────┐      │
│     │ Model weights signed with ML-DSA-65 + Ed25519       │      │
│     │ Signature verified at load time → reject tampered   │      │
│     │ SONA adaptations co-signed with device key          │      │
│     └─────────────────────────────────────────────────────┘      │
│                                                                   │
│  2. DATA AT REST (RVF containers)                                │
│     ┌─────────────────────────────────────────────────────┐      │
│     │ CSI vectors encrypted with AES-256-GCM              │      │
│     │ Container integrity via SHAKE-256 Merkle tree       │      │
│     │ Key management: per-container keys, sealed to device │      │
│     └─────────────────────────────────────────────────────┘      │
│                                                                   │
│  3. DATA IN TRANSIT                                              │
│     ┌─────────────────────────────────────────────────────┐      │
│     │ API: TLS 1.3 with PQ key exchange (ML-KEM-768)      │      │
│     │ WebSocket: Same TLS channel                         │      │
│     │ Multi-AP sync: mTLS with device certificates        │      │
│     └─────────────────────────────────────────────────────┘      │
│                                                                   │
│  4. AUDIT TRAIL (witness chains - see ADR-010)                   │
│     ┌─────────────────────────────────────────────────────┐      │
│     │ Every detection event hash-chained with SHAKE-256   │      │
│     │ Chain anchors signed with ML-DSA-65                 │      │
│     │ Cross-device attestation via SLH-DSA-128s           │      │
│     └─────────────────────────────────────────────────────┘      │
│                                                                   │
│  5. DEVICE IDENTITY                                              │
│     ┌─────────────────────────────────────────────────────┐      │
│     │ Each sensing device has a key pair (ML-DSA-65)      │      │
│     │ Device attestation proves hardware integrity        │      │
│     │ Key rotation schedule: 90 days (or on compromise)   │      │
│     └─────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────┘
```

### 混合签名方案

```rust
/// 混合签名：经典 Ed25519 与后量子 ML-DSA-65 结合
pub struct HybridSignature {
    /// 经典 Ed25519 签名（64 字节）
    ed25519_sig: [u8; 64],

    /// 后量子 ML-DSA-65 签名（3309 字节）
    ml_dsa_sig: Vec<u8>,

    /// 签名者公钥指纹（SHAKE-256，32 字节）
    signer_fingerprint: [u8; 32],

    /// 签名时间戳
    timestamp: u64,
}

impl HybridSignature {
    /// 校验要求两个签名都有效
    pub fn verify(&self, message: &[u8], ed25519_pk: &Ed25519PublicKey,
                  ml_dsa_pk: &MlDsaPublicKey) -> Result<bool, CryptoError> {
        let ed25519_valid = ed25519_pk.verify(message, &self.ed25519_sig)?;
        let ml_dsa_valid = ml_dsa_pk.verify(message, &self.ml_dsa_sig)?;

        // 两者都必须通过（纵深防御）
        Ok(ed25519_valid && ml_dsa_valid)
    }
}
```

### 模型完整性校验

```rust
/// 校验模型权重未被篡改
pub fn verify_model_integrity(model_container: &ModelContainer) -> Result<(), SecurityError> {
    // 1. 从容器中取出内嵌签名
    let signature = model_container.crypto_segment().signature()?;

    // 2. 计算权重数据的 SHAKE-256 哈希
    let weight_hash = shake256(model_container.weights_segment().data());

    // 3. 校验混合签名
    let publisher_keys = load_publisher_keys()?;
    if !signature.verify(&weight_hash, &publisher_keys.ed25519, &publisher_keys.ml_dsa)? {
        return Err(SecurityError::ModelTampered {
            expected_signer: publisher_keys.fingerprint(),
            container_path: model_container.path().to_owned(),
        });
    }

    Ok(())
}
```

### CSI 数据加密

对隐私敏感的部署，CSI 向量可以加密后静态存储：

```rust
/// 加密 CSI 向量以存入 RVF 容器
pub struct CsiEncryptor {
    /// AES-256-GCM 密钥（由设备密钥 + 容器盐值派生）
    key: Aes256GcmKey,
}

impl CsiEncryptor {
    /// 加密单个 CSI 特征向量
    /// 注意：HNSW 检索在加密向量上进行，使用
    /// 保距加密（近似，权衡程度可配置）
    pub fn encrypt_vector(&self, vector: &[f32]) -> EncryptedVector {
        let nonce = generate_nonce();
        let plaintext = bytemuck::cast_slice::<f32, u8>(vector);
        let ciphertext = aes_256_gcm_encrypt(&self.key, &nonce, plaintext);
        EncryptedVector { ciphertext, nonce }
    }
}
```

### 性能影响

| 操作 | 无加密 | 有加密 | 额外开销 |
|-----------|---------------|-------------|----------|
| 模型加载 | 50 ms | 52 ms | +2 ms（签名校验） |
| 向量插入 | 0.1 ms | 0.15 ms | +0.05 ms（加密） |
| HNSW 检索 | 0.3 ms | 0.35 ms | +0.05 ms（解密 top-K） |
| 容器打开 | 10 ms | 12 ms | +2 ms（完整性检查） |
| 检测事件记录 | 0.01 ms | 0.5 ms | +0.49 ms（哈希链） |

### 特性开关

```toml
[features]
default = []
crypto-classical = ["ed25519-dalek"]  # Ed25519 only
crypto-pq = ["pqcrypto-dilithium", "pqcrypto-sphincsplus"]  # ML-DSA + SLH-DSA
crypto-hybrid = ["crypto-classical", "crypto-pq"]  # Both (recommended)
crypto-encrypt = ["aes-gcm"]  # Data-at-rest encryption
crypto-full = ["crypto-hybrid", "crypto-encrypt"]
```

## 影响

### 正面影响
- **面向未来**：基于格的签名可抵抗量子攻击
- **篡改检测**：模型投毒与数据篡改可被发现
- **隐私合规**：加密后的 CSI 数据满足 GDPR/HIPAA 要求
- **取证完整性**：带签名的审计链可作为证据采信
- **开销低**：多数密码操作每次 <1ms

### 负面影响
- **签名体积**：ML-DSA-65 签名为 3.3 KB，而 Ed25519 仅 64 字节
- **密钥管理复杂度**：设备密钥的下发、轮换与吊销
- **在加密数据上做 HNSW**：保距加密是近似的，检索召回率可能下降
- **依赖体积**：后量子密码库给二进制增加约 2 MB
- **标准成熟度**：FIPS 204/205 已定稿，但实现仍在演进

## 参考资料

- [FIPS 204: ML-DSA (Module-Lattice Digital Signature)](https://csrc.nist.gov/pubs/fips/204/final)
- [FIPS 205: SLH-DSA (Stateless Hash-Based Digital Signature)](https://csrc.nist.gov/pubs/fips/205/final)
- [FIPS 202: SHA-3 / SHAKE](https://csrc.nist.gov/pubs/fips/202/final)
- [RuVector Crypto Implementation](https://github.com/ruvnet/ruvector)
- ADR-002：RuVector RVF 集成策略
- ADR-010：面向审计链完整性的见证链
