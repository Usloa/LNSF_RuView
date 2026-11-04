// Internationalization - EN/PL/ZH language support, defaults to ZH
// Persists user choice, translates UI strings via data-i18n attributes

const translations = {
  en: {
    // Navigation
    'nav.dashboard': 'Dashboard',
    'nav.hardware': 'Hardware',
    'nav.demo': 'Live Demo',
    'nav.architecture': 'Architecture',
    'nav.performance': 'Performance',
    'nav.applications': 'Applications',
    'nav.sensing': 'Sensing',
    'nav.training': 'Training',
    'nav.poseFusion': 'Pose Fusion',
    'nav.observatory': 'Observatory',
    'nav.skipToContent': 'Skip to main content',

    // Dashboard
    'dashboard.title': 'Revolutionary WiFi-Based Human Pose Detection',
    'dashboard.subtitle': 'Human Tracking Through Walls Using WiFi Signals',
    'dashboard.description': 'AI can track your full-body movement through walls using just WiFi signals. Researchers at Carnegie Mellon have trained a neural network to turn basic WiFi signals into detailed wireframe models of human bodies.',
    'dashboard.status': 'System Status',
    'dashboard.metrics': 'System Metrics',
    'dashboard.features': 'Features',
    'dashboard.liveStats': 'Live Statistics',
    'dashboard.activePersons': 'Active Persons',
    'dashboard.avgConfidence': 'Avg Confidence',
    'dashboard.totalDetections': 'Total Detections',
    'dashboard.zoneOccupancy': 'Zone Occupancy',

    // Status
    'status.apiServer': 'API Server',
    'status.hardware': 'Hardware',
    'status.inference': 'Inference',
    'status.streaming': 'Streaming',
    'status.dataSource': 'Data Source',

    // Metrics
    'metrics.cpu': 'CPU Usage',
    'metrics.memory': 'Memory Usage',
    'metrics.disk': 'Disk Usage',

    // Benefits
    'benefit.throughWalls': 'Through Walls',
    'benefit.throughWallsDesc': 'Works through solid barriers with no line of sight required',
    'benefit.privacy': 'Privacy-Preserving',
    'benefit.privacyDesc': 'No cameras or visual recording - just WiFi signal analysis',
    'benefit.realtime': 'Real-Time',
    'benefit.realtimeDesc': 'Maps 24 body regions in real-time at 100Hz sampling rate',
    'benefit.lowCost': 'Low Cost',
    'benefit.lowCostDesc': 'Built using $30 commercial WiFi hardware',

    // Stats
    'stat.bodyRegions': 'Body Regions',
    'stat.samplingRate': 'Sampling Rate',
    'stat.accuracy': 'Accuracy (AP@50)',
    'stat.hardwareCost': 'Hardware Cost',

    // Actions
    'action.startDetection': 'Start Detection',
    'action.stopDetection': 'Stop Detection',
    'action.toggleTheme': 'Toggle theme',
    'action.exportData': 'Export data',
    'action.screenshot': 'Take screenshot',

    // Connection
    'conn.connected': 'Connected',
    'conn.connecting': 'Connecting...',
    'conn.offline': 'Offline',
    'conn.reconnecting': 'Reconnecting...',
    'conn.live': 'Live',
    'conn.simulated': 'Simulated',

    // Misc
    'misc.loading': 'Loading...',
    'misc.error': 'An error occurred',
    'misc.noData': 'No data available',
    'misc.close': 'Close',
    'misc.cancel': 'Cancel',
    'misc.confirm': 'Confirm',
    'misc.settings': 'Settings',
    'misc.language': 'Language',

    // 硬件 / 演示 / 架构 / 性能 / 应用 / 实施
    'hardware.title': 'Hardware Configuration',
    'hardware.hint': 'Click antennas to toggle their state',
    'hardware.transmitters': 'Transmitters (3)',
    'hardware.receivers': 'Receivers (6)',
    'hardware.wifiConfig': 'WiFi Configuration',
    'hardware.frequency': 'Frequency',
    'hardware.subcarriers': 'Subcarriers',
    'hardware.samplingRate': 'Sampling Rate',
    'hardware.totalCost': 'Total Cost',
    'hardware.csiData': 'Real-time CSI Data',
    'hardware.amplitude': 'Amplitude:',
    'hardware.phase': 'Phase:',
    'demo.title': 'Live Demonstration',
    'demo.start': 'Start Stream',
    'demo.stop': 'Stop Stream',
    'demo.ready': 'Ready',
    'demo.signalAnalysis': 'WiFi Signal Analysis',
    'demo.signalStrength': 'Signal Strength:',
    'demo.latency': 'Processing Latency:',
    'demo.poseDetection': 'Human Pose Detection',
    'demo.persons': 'Persons Detected:',
    'demo.confidence': 'Confidence:',
    'demo.keypoints': 'Keypoints:',
    'arch.title': 'System Architecture',
    'arch.csiInput': 'CSI Input',
    'arch.csiInputDesc': 'Channel State Information collected from WiFi antenna array',
    'arch.phaseSanitization': 'Phase Sanitization',
    'arch.phaseDesc': 'Remove hardware-specific noise and normalize signal phase',
    'arch.modalityTranslation': 'Modality Translation',
    'arch.modalityDesc': 'Convert WiFi signals to visual representation using CNN',
    'arch.denseposeRcnn': 'DensePose-RCNN',
    'arch.denseposeDesc': 'Extract human pose keypoints and body part segmentation',
    'arch.wireframe': 'Wireframe Output',
    'arch.wireframeDesc': 'Generate final human pose wireframe visualization',
    'perf.title': 'Performance Analysis',
    'perf.wifiBased': 'WiFi-based (Same Layout)',
    'perf.wifiAp': 'Average Precision:',
    'perf.wifiAp50': 'AP@50:',
    'perf.wifiAp75': 'AP@75:',
    'perf.imageBased': 'Image-based (Reference)',
    'perf.imageAp': 'Average Precision:',
    'perf.imageAp50': 'AP@50:',
    'perf.imageAp75': 'AP@75:',
    'perf.advantagesLimitations': 'Advantages & Limitations',
    'perf.advantages': 'Advantages',
    'perf.adv1': 'Through-wall detection',
    'perf.adv2': 'Privacy preserving',
    'perf.adv3': 'Lighting independent',
    'perf.adv4': 'Low cost hardware',
    'perf.adv5': 'Uses existing WiFi',
    'perf.limitations': 'Limitations',
    'perf.lim1': 'Performance drops in different layouts',
    'perf.lim2': 'Requires WiFi-compatible devices',
    'perf.lim3': 'Training requires synchronized data',
    'apps.title': 'Real-World Applications',
    'apps.elderly': 'Elderly Care Monitoring',
    'apps.fall': 'Fall Detection',
    'apps.activity': 'Activity Monitoring',
    'apps.emergency': 'Emergency Alert',
    'apps.security': 'Home Security Systems',
    'apps.intrusion': 'Intrusion Detection',
    'apps.multiPerson': 'Multi-person Tracking',
    'apps.invisible': 'Invisible Monitoring',
    'apps.healthcare': 'Healthcare Patient Monitoring',
    'apps.vital': 'Vital Sign Analysis',
    'apps.movement': 'Movement Tracking',
    'apps.healthAlerts': 'Health Alerts',
    'apps.building': 'Smart Building Occupancy',
    'apps.energy': 'Energy Optimization',
    'apps.occupancy': 'Occupancy Tracking',
    'apps.controls': 'Smart Controls',
    'apps.arvr': 'AR/VR Applications',
    'apps.fullBody': 'Full Body Tracking',
    'apps.sensorFree': 'Sensor-free',
    'apps.immersive': 'Immersive Experience',
    'impl.title': 'Implementation Considerations',
    'impl.modelTraining': 'Model Training',
    'impl.modelTrainingDesc': 'Record CSI data, train pose estimation models, and manage .rvf files',
  },

  pl: {
    // Navigation
    'nav.dashboard': 'Panel',
    'nav.hardware': 'Sprzet',
    'nav.demo': 'Demo na zywo',
    'nav.architecture': 'Architektura',
    'nav.performance': 'Wydajnosc',
    'nav.applications': 'Aplikacje',
    'nav.sensing': 'Czujniki',
    'nav.training': 'Trening',
    'nav.poseFusion': 'Fuzja pozy',
    'nav.observatory': 'Obserwatorium',
    'nav.skipToContent': 'Przejdz do tresci',

    // Dashboard
    'dashboard.title': 'Rewolucyjne wykrywanie pozy czlowieka przez WiFi',
    'dashboard.subtitle': 'Sledzenie ludzi przez sciany za pomoca sygnalow WiFi',
    'dashboard.description': 'AI moze sledzic ruchy calego ciala przez sciany uzywajac jedynie sygnalow WiFi. Badacze z Carnegie Mellon wytrenowali siec neuronowa do zamiany sygnalow WiFi w szczegolowe modele szkieletowe.',
    'dashboard.status': 'Status systemu',
    'dashboard.metrics': 'Metryki systemu',
    'dashboard.features': 'Funkcje',
    'dashboard.liveStats': 'Statystyki na zywo',
    'dashboard.activePersons': 'Aktywne osoby',
    'dashboard.avgConfidence': 'Srednia pewnosc',
    'dashboard.totalDetections': 'Laczne detekcje',
    'dashboard.zoneOccupancy': 'Zajecie stref',

    // Status
    'status.apiServer': 'Serwer API',
    'status.hardware': 'Sprzet',
    'status.inference': 'Wnioskowanie',
    'status.streaming': 'Streaming',
    'status.dataSource': 'Zrodlo danych',

    // Metrics
    'metrics.cpu': 'Uzycie CPU',
    'metrics.memory': 'Uzycie pamieci',
    'metrics.disk': 'Uzycie dysku',

    // Benefits
    'benefit.throughWalls': 'Przez sciany',
    'benefit.throughWallsDesc': 'Dziala przez przeszkody stale bez linii wzroku',
    'benefit.privacy': 'Ochrona prywatnosci',
    'benefit.privacyDesc': 'Brak kamer i nagrywania - tylko analiza sygnalow WiFi',
    'benefit.realtime': 'Czas rzeczywisty',
    'benefit.realtimeDesc': 'Mapuje 24 regiony ciala w czasie rzeczywistym przy 100Hz',
    'benefit.lowCost': 'Niski koszt',
    'benefit.lowCostDesc': 'Zbudowany z komercyjnego sprzetu WiFi za $30',

    // Stats
    'stat.bodyRegions': 'Regiony ciala',
    'stat.samplingRate': 'Czestotliwosc',
    'stat.accuracy': 'Dokladnosc (AP@50)',
    'stat.hardwareCost': 'Koszt sprzetu',

    // Actions
    'action.startDetection': 'Rozpocznij detekcje',
    'action.stopDetection': 'Zatrzymaj detekcje',
    'action.toggleTheme': 'Zmien motyw',
    'action.exportData': 'Eksportuj dane',
    'action.screenshot': 'Zrob zrzut ekranu',

    // Connection
    'conn.connected': 'Polaczono',
    'conn.connecting': 'Laczenie...',
    'conn.offline': 'Offline',
    'conn.reconnecting': 'Ponowne laczenie...',
    'conn.live': 'Na zywo',
    'conn.simulated': 'Symulacja',

    // Misc
    'misc.loading': 'Ladowanie...',
    'misc.error': 'Wystapil blad',
    'misc.noData': 'Brak danych',
    'misc.close': 'Zamknij',
    'misc.cancel': 'Anuluj',
    'misc.confirm': 'Potwierdz',
    'misc.settings': 'Ustawienia',
    'misc.language': 'Jezyk'
  },

  zh: {
    // 导航
    'nav.dashboard': '仪表盘',
    'nav.hardware': '硬件',
    'nav.demo': '实时演示',
    'nav.architecture': '架构',
    'nav.performance': '性能',
    'nav.applications': '应用场景',
    'nav.sensing': '感知',
    'nav.training': '训练',
    'nav.poseFusion': '姿态融合',
    'nav.observatory': '观测站',
    'nav.skipToContent': '跳到主要内容',

    // 仪表盘
    'dashboard.title': '基于 WiFi 的人体姿态检测',
    'dashboard.subtitle': '利用 WiFi 信号穿墙追踪人体',
    'dashboard.description': 'AI 仅凭 WiFi 信号即可穿墙追踪你的全身动作。卡内基梅隆大学的研究者训练了一个神经网络，把普通 WiFi 信号转化为精细的人体骨架模型。',
    'dashboard.status': '系统状态',
    'dashboard.metrics': '系统指标',
    'dashboard.features': '核心特性',
    'dashboard.liveStats': '实时统计',
    'dashboard.activePersons': '活跃人数',
    'dashboard.avgConfidence': '平均置信度',
    'dashboard.totalDetections': '累计检测次数',
    'dashboard.zoneOccupancy': '区域占用',

    // 状态
    'status.apiServer': 'API 服务',
    'status.hardware': '硬件',
    'status.inference': '推理',
    'status.streaming': '数据流',
    'status.dataSource': '数据源',

    // 指标
    'metrics.cpu': 'CPU 占用',
    'metrics.memory': '内存占用',
    'metrics.disk': '磁盘占用',

    // 优势
    'benefit.throughWalls': '可穿墙',
    'benefit.throughWallsDesc': '可穿透实体屏障工作，无需视距',
    'benefit.privacy': '保护隐私',
    'benefit.privacyDesc': '无摄像头、无影像录制——仅分析 WiFi 信号',
    'benefit.realtime': '实时',
    'benefit.realtimeDesc': '以 100Hz 采样率实时映射 24 个人体区域',
    'benefit.lowCost': '低成本',
    'benefit.lowCostDesc': '基于 30 美元的商用 WiFi 硬件构建',

    // 统计
    'stat.bodyRegions': '人体区域',
    'stat.samplingRate': '采样率',
    'stat.accuracy': '准确率（AP@50）',
    'stat.hardwareCost': '硬件成本',

    // 操作
    'action.startDetection': '开始检测',
    'action.stopDetection': '停止检测',
    'action.toggleTheme': '切换主题',
    'action.exportData': '导出数据',
    'action.screenshot': '截取屏幕',

    // 连接
    'conn.connected': '已连接',
    'conn.connecting': '连接中…',
    'conn.offline': '离线',
    'conn.reconnecting': '正在重连…',
    'conn.live': '实时',
    'conn.simulated': '模拟',

    // 其他
    'misc.loading': '加载中…',
    'misc.error': '发生错误',
    'misc.noData': '暂无数据',
    'misc.close': '关闭',
    'misc.cancel': '取消',
    'misc.confirm': '确认',
    'misc.settings': '设置',
    'misc.language': '语言',

    // 硬件 / 演示 / 架构 / 性能 / 应用 / 实施
    'hardware.title': '硬件配置',
    'hardware.hint': '点击天线可切换其状态',
    'hardware.transmitters': '发射端（3）',
    'hardware.receivers': '接收端（6）',
    'hardware.wifiConfig': 'WiFi 配置',
    'hardware.frequency': '频率',
    'hardware.subcarriers': '子载波',
    'hardware.samplingRate': '采样率',
    'hardware.totalCost': '总成本',
    'hardware.csiData': '实时 CSI 数据',
    'hardware.amplitude': '幅度：',
    'hardware.phase': '相位：',
    'demo.title': '实时演示',
    'demo.start': '开始数据流',
    'demo.stop': '停止数据流',
    'demo.ready': '就绪',
    'demo.signalAnalysis': 'WiFi 信号分析',
    'demo.signalStrength': '信号强度：',
    'demo.latency': '处理延迟：',
    'demo.poseDetection': '人体姿态检测',
    'demo.persons': '检测到人数：',
    'demo.confidence': '置信度：',
    'demo.keypoints': '关键点：',
    'arch.title': '系统架构',
    'arch.csiInput': 'CSI 输入',
    'arch.csiInputDesc': '从 WiFi 天线阵列采集的信道状态信息',
    'arch.phaseSanitization': '相位净化',
    'arch.phaseDesc': '去除硬件相关噪声并归一化信号相位',
    'arch.modalityTranslation': '模态转换',
    'arch.modalityDesc': '使用 CNN 将 WiFi 信号转换为视觉表征',
    'arch.denseposeRcnn': 'DensePose-RCNN',
    'arch.denseposeDesc': '提取人体姿态关键点与身体部位分割',
    'arch.wireframe': '骨架输出',
    'arch.wireframeDesc': '生成最终的人体姿态骨架可视化',
    'perf.title': '性能分析',
    'perf.wifiBased': '基于 WiFi（相同布局）',
    'perf.wifiAp': '平均精度：',
    'perf.wifiAp50': 'AP@50：',
    'perf.wifiAp75': 'AP@75：',
    'perf.imageBased': '基于图像（参考）',
    'perf.imageAp': '平均精度：',
    'perf.imageAp50': 'AP@50：',
    'perf.imageAp75': 'AP@75：',
    'perf.advantagesLimitations': '优势与局限',
    'perf.advantages': '优势',
    'perf.adv1': '可穿墙检测',
    'perf.adv2': '保护隐私',
    'perf.adv3': '不依赖光照',
    'perf.adv4': '低成本硬件',
    'perf.adv5': '复用既有 WiFi',
    'perf.limitations': '局限',
    'perf.lim1': '更换布局后性能下降',
    'perf.lim2': '需要支持 WiFi 的设备',
    'perf.lim3': '训练需要同步采集的数据',
    'apps.title': '真实应用场景',
    'apps.elderly': '养老照护监测',
    'apps.fall': '跌倒检测',
    'apps.activity': '活动监测',
    'apps.emergency': '紧急告警',
    'apps.security': '家庭安防系统',
    'apps.intrusion': '入侵检测',
    'apps.multiPerson': '多人追踪',
    'apps.invisible': '无感监测',
    'apps.healthcare': '医疗患者监测',
    'apps.vital': '生命体征分析',
    'apps.movement': '运动追踪',
    'apps.healthAlerts': '健康告警',
    'apps.building': '智能楼宇占用',
    'apps.energy': '能耗优化',
    'apps.occupancy': '占用追踪',
    'apps.controls': '智能控制',
    'apps.arvr': 'AR/VR 应用',
    'apps.fullBody': '全身追踪',
    'apps.sensorFree': '无需传感器',
    'apps.immersive': '沉浸式体验',
    'impl.title': '实施考虑',
    'impl.modelTraining': '模型训练',
    'impl.modelTrainingDesc': '录制 CSI 数据、训练姿态估计模型并管理 .rvf 文件',
  }
};

/** 默认语言：中文。用户在选择器中的选择会持久化到 localStorage 并优先生效。 */
const DEFAULT_LOCALE = 'zh';

export class I18n {
  constructor() {
    this.locale = this.getSavedLocale() || this.detectLocale();
    this.listeners = [];
  }

  init() {
    document.documentElement.setAttribute('lang', this.locale);
    this.createSelector();
    this.applyTranslations();
  }

  /**
   * 返回默认语言。
   *
   * 本方法原按 navigator.language 自动检测 zh 与 pl 前缀，
   * 现按产品要求统一默认中文；用户仍可通过语言选择器切换到 EN / PL，
   * 切换结果由 getSavedLocale() 持久化并在下次访问时优先采用。
   */
  detectLocale() {
    return DEFAULT_LOCALE;
  }

  getSavedLocale() {
    try {
      const saved = localStorage.getItem('ruview-locale');
      return saved && translations[saved] ? saved : null;
    } catch { return null; }
  }

  saveLocale(locale) {
    try { localStorage.setItem('ruview-locale', locale); }
    catch { /* noop */ }
  }

  t(key) {
    const dict = translations[this.locale] || translations.en;
    return dict[key] || translations.en[key] || key;
  }

  setLocale(locale) {
    if (!translations[locale]) return;
    this.locale = locale;
    this.saveLocale(locale);
    document.documentElement.setAttribute('lang', locale);
    this.applyTranslations();
    this.listeners.forEach(cb => { try { cb(locale); } catch { /* noop */ } });
  }

  onLocaleChange(callback) {
    this.listeners.push(callback);
    return () => {
      const i = this.listeners.indexOf(callback);
      if (i > -1) this.listeners.splice(i, 1);
    };
  }

  applyTranslations() {
    // Translate elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      el.textContent = this.t(key);
    });

    // Translate placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      el.placeholder = this.t(key);
    });

    // Translate aria-labels
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
      const key = el.getAttribute('data-i18n-aria');
      el.setAttribute('aria-label', this.t(key));
    });

    // Update language selector
    const selector = document.getElementById('lang-selector');
    if (selector) selector.value = this.locale;
  }

  createSelector() {
    const wrapper = document.createElement('div');
    wrapper.className = 'lang-selector-wrap';
    wrapper.innerHTML = `
      <select id="lang-selector" class="lang-selector" aria-label="语言">
        <option value="zh">中文</option>
        <option value="en">EN</option>
        <option value="pl">PL</option>
      </select>
    `;

    const select = wrapper.querySelector('select');
    select.value = this.locale;
    select.addEventListener('change', () => this.setLocale(select.value));

    const headerInfo = document.querySelector('.header-info');
    if (headerInfo) {
      headerInfo.appendChild(wrapper);
    }
  }

  getAvailableLocales() {
    return Object.keys(translations);
  }

  dispose() {
    this.listeners = [];
  }
}

export const i18n = new I18n();
