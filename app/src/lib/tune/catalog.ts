// Component catalog for 65–75 mm racing TinyWhoops (weights in grams, approximate).
// Category: frame | motor | prop | fc | camera | vtx | receiver | battery | canopy
// cells: '1S' | '2S' — для группировки компонентов по питанию (моторы, платы, АКБ).
// Внутри каждой категории — группировка по типоразмеру (65/75 мм, 0702/0802/…, 31/40 мм,
// 1S/2S), внутри группы — сортировка по производителю в алфавитном порядке.

export type Category = 'frame' | 'motor' | 'prop' | 'fc' | 'camera' | 'vtx' | 'receiver' | 'battery' | 'canopy'
export type FrameClass = '65' | '75'

export interface Component {
  id: string
  name: string
  weight: number // grams
  cls?: FrameClass
  kv?: number
  cells?: '1S' | '2S'
  blades?: number // prop: число лопастей (влияет на нагрузку/шум)
  aggr?: 'light' | 'aggressive' // prop: лёгкие или агрессивный шаг
  bearing?: 'ball' // motor: шариковые подшипники — меньше механического шума
  gyro?: 'mpu6000' | 'icm42688' | 'bmi270' // fc: тип гироскопа — влияет на фильтрацию
  note?: string
}

export interface CategoryDef {
  id: Category
  title: string
  required: boolean
  items: Component[]
}

// Правило влияния компонента на тюн (поверх поправки по весу)
export type InfluenceTarget = 'pAdj' | 'dAdj' | 'lpf2Delta' | 'lpf2Cap' | 'dynNotchMin'
export interface InfluenceRule {
  target: InfluenceTarget
  value: number
  desc: string
  reason: string
}

export const CATEGORIES: CategoryDef[] = [
  {
    id: 'frame',
    title: 'Рама',
    required: true,
    items: [
      // 65 мм
      { id: 'f65_air65', name: 'BetaFPV Air65', weight: 2.8, cls: '65' },
      { id: 'f65_meteor', name: 'BetaFPV Meteor65 Pro', weight: 3.0, cls: '65' },
      { id: 'f65_mobula6', name: 'Happymodel Mobula6 V2', weight: 3.2, cls: '65' },
      { id: 'f65_cockroach_liteaf', name: 'NBD Cockroach 65 LiteAF', weight: 2.3, cls: '65', note: 'гоночная, лёгкая' },
      { id: 'f65_cockroach_v3', name: 'NBD Cockroach V3 65', weight: 2.8, cls: '65', note: 'прочная PP' },
      // 75 мм
      { id: 'f75_air75', name: 'BetaFPV Air75', weight: 4.0, cls: '75' },
      { id: 'f75_meteor75', name: 'BetaFPV Meteor75 Pro', weight: 4.4, cls: '75' },
      { id: 'f75_mobula7', name: 'Happymodel Mobula7 (75мм)', weight: 4.6, cls: '75' },
      { id: 'f75_cockroach75', name: 'NBD Cockroach 75', weight: 3.9, cls: '75' },
      { id: 'f75_cockroach75_cb', name: 'NBD Cockroach 75 + карбоновый усилитель', weight: 4.6, cls: '75', note: 'жёстче, для гонок' },
      { id: 'f75_cockroach_liteaf', name: 'NBD Cockroach LiteAF 75', weight: 3.2, cls: '75', note: 'лёгкая версия' },
      { id: 'f75_cockroach_liteaf_cb', name: 'NBD Cockroach LiteAF 75 + карбоновый усилитель', weight: 3.9, cls: '75', note: 'жёстче, для гонок' },
    ],
  },
  {
    id: 'motor',
    title: 'Моторы (4 шт.)',
    required: true,
    items: [
      // 0702
      { id: 'm0702_27000', name: 'NBD Flow 0702 27000KV', weight: 6.8, kv: 27000, cells: '1S', bearing: 'ball', note: 'ультралёгкие, для 65мм' },
      { id: 'm0702_rc_gts', name: 'RCinPower GTS V3 0702 27000KV', weight: 6.0, kv: 27000, cells: '1S', bearing: 'ball', note: 'премиум, ~20 Вт' },
      { id: 'm0702_vci_spark', name: 'VCI Spark 0702 29000KV', weight: 6.1, kv: 29000, cells: '1S', bearing: 'ball', note: 'гоночные, до 16 Вт' },
      // 0802
      { id: 'm0802_nbd_30000', name: 'NBD 0802 30000KV (двойной подшипник)', weight: 8.8, kv: 30000, cells: '1S', bearing: 'ball', note: 'максимум тяги' },
      { id: 'm0802_rc_evo', name: 'RCinPower EVO 0802 25000KV', weight: 7.4, kv: 25000, cells: '1S', bearing: 'ball' },
      { id: 'm0802_rc_gts25', name: 'RCinPower GTS V3 0802 25000KV', weight: 7.9, kv: 25000, cells: '1S', bearing: 'ball', note: 'гоночный баланс' },
      { id: 'm0802_rc_gts27', name: 'RCinPower GTS V3 0802 27000KV', weight: 7.9, kv: 27000, cells: '1S', bearing: 'ball', note: 'агрессивные' },
      { id: 'm0802_vci_pro', name: 'VCI 0802 PRO 25666KV', weight: 7.2, kv: 25666, cells: '1S', bearing: 'ball', note: 'кусачие, 27.8 Вт' },
      { id: 'm0802_vci_spark22', name: 'VCI Spark 0802 22000KV', weight: 7.9, kv: 22000, cells: '1S', bearing: 'ball' },
      { id: 'm0802_vci_spark25', name: 'VCI Spark 0802 25000KV', weight: 7.9, kv: 25000, cells: '1S', bearing: 'ball', note: '25.2 Вт' },
      { id: 'm0802_vci_spark27', name: 'VCI Spark 0802 27000KV', weight: 7.8, kv: 27000, cells: '1S', bearing: 'ball', note: 'агрессивные, 26 Вт' },
      { id: 'm0802_19000', name: '0802 19000KV', weight: 6.4, kv: 19000, cells: '1S', note: 'эффективные, мягче' },
      { id: 'm0802_22000', name: '0802 22000KV', weight: 6.4, kv: 22000, cells: '1S' },
      { id: 'm0802_25000', name: '0802 25000KV', weight: 6.4, kv: 25000, cells: '1S', note: 'агрессивные' },
      // 0802.5 / 1002
      { id: 'm08028_12000', name: '0802.5 12000KV', weight: 6.8, kv: 12000, note: 'спокойные, эффективные' },
      { id: 'm1002_19000', name: '1002 19000KV', weight: 10.4, kv: 19000, note: 'для 75мм, много тяги' },
      // 1102
      { id: 'm1102_14000', name: '1102 14000KV', weight: 11.2, kv: 14000, cells: '1S', note: 'для 75мм 1S, агрессивные' },
      { id: 'm1102_10000', name: '1102 10000KV', weight: 11.2, kv: 10000, cells: '2S', note: 'для 75мм 2S' },
      { id: 'm1102_8000', name: '1102 8000KV', weight: 11.2, kv: 8000, cells: '2S', note: 'для тяжёлых 75мм 2S' },
    ],
  },
  {
    id: 'prop',
    title: 'Пропеллеры',
    required: true,
    items: [
      // 31 мм
      { id: 'p31_gemfan1209_4', name: 'Gemfan 1209-4 (31мм, 4 лопасти)', weight: 1.1, blades: 4, aggr: 'aggressive', note: 'высокий шаг' },
      { id: 'p31_gemfan1210_2', name: 'Gemfan 1210-2 (31мм, 2 лопасти)', weight: 0.9, blades: 2 },
      { id: 'p31_gemfan1210', name: 'Gemfan 1210-3 (31мм, 3 лопасти)', weight: 1.0, blades: 3 },
      { id: 'p31_gemfan1219', name: 'Gemfan 1219-3 (31мм, 3 лопасти)', weight: 1.0, blades: 3, note: 'тихие, эффективные' },
      { id: 'p31_gemfan1219s', name: 'Gemfan 1219S-3 (31мм, 3 лопасти)', weight: 1.0, blades: 3, note: 'поликарбонат, прочные' },
      { id: 'p31_gemfan1220', name: 'Gemfan 1220 (31мм, 2 лопасти)', weight: 0.9, blades: 2 },
      { id: 'p31_gemfan1220_4', name: 'Gemfan 1220-4 (31мм, 4 лопасти)', weight: 1.1, blades: 4, aggr: 'aggressive', note: 'много тяги' },
      { id: 'p31_hq_1212', name: 'HQProp 1.2×1.2 (31мм, 2 лопасти)', weight: 0.9, blades: 2 },
      { id: 'p31_hq_1234', name: 'HQProp 1.2×1.3×4 (31мм, 4 лопасти)', weight: 1.1, blades: 4, aggr: 'aggressive', note: 'кусачие' },
      { id: 'p31_hq_ul', name: 'HQProp Ultralight 1.2×1×3 (31мм)', weight: 0.8, blades: 3, aggr: 'light', note: 'ультралёгкие' },
      { id: 'p31_hq_x4', name: 'HQProp 31MMX4 (31мм, 4 лопасти)', weight: 1.1, blades: 4, aggr: 'aggressive' },
      { id: 'p31_nbd_azi', name: 'NBD Azi 31мм (3 лопасти)', weight: 1.0, blades: 3 },
      // 40 мм
      { id: 'p40_gemfan1608', name: 'Gemfan 1608-3 (40мм, 3 лопасти)', weight: 1.7, blades: 3, aggr: 'aggressive', note: 'кусачие' },
      { id: 'p40_gemfan1610', name: 'Gemfan 1610-2 Durable (40мм, 2 лопасти)', weight: 1.6, blades: 2, note: 'поликарбонат' },
      { id: 'p40_gemfan1611', name: 'Gemfan 1611-3 (40мм, 3 лопасти)', weight: 1.4, blades: 3, aggr: 'light', note: 'лёгкие, для гонок' },
      { id: 'p40_gemfan1635', name: 'Gemfan 1635-3 (40мм, 3 лопасти)', weight: 1.6, blades: 3, note: 'классика 75мм' },
      { id: 'p40_gemfan1636', name: 'Gemfan 1636-4 (40мм, 4 лопасти)', weight: 1.7, blades: 4, aggr: 'aggressive', note: 'много тяги' },
      { id: 'p40_hq_ul', name: 'HQProp Ultralight 40MMX2 (40мм)', weight: 1.3, blades: 2, aggr: 'light', note: 'лёгкие, для 75мм' },
      { id: 'p40_hq_ul3', name: 'HQProp Ultralight 1.6×1×3 (40мм, 3 лопасти)', weight: 1.3, blades: 3, aggr: 'light' },
      { id: 'p40_hq_x3', name: 'HQProp 40MMX3 (40мм, для Air75)', weight: 1.6, blades: 3 },
      { id: 'p40_nbd_azi', name: 'NBD Azi 40мм (3 лопасти)', weight: 1.6, blades: 3 },
    ],
  },
  {
    id: 'fc',
    title: 'Плата FC/ESC (AIO)',
    required: true,
    items: [
      // 1S
      { id: 'fc_matrix3in1', name: 'BetaFPV Matrix 3-in-1 (F4 1S AIO, ICM42688)', weight: 4.4, cells: '1S', gyro: 'icm42688' },
      { id: 'fc_matrix3in1_bmi', name: 'BetaFPV Matrix 3-in-1 (F4 1S AIO, BMI270)', weight: 4.4, cells: '1S', gyro: 'bmi270', note: 'с янв. 2026' },
      { id: 'fc_f4_5a', name: 'F4 1S AIO 5A (ELRS встроен)', weight: 3.4, cells: '1S' },
      { id: 'fc_f411_5a', name: 'F411 1S AIO 5A', weight: 3.6, cells: '1S' },
      { id: 'fc_g473_5a', name: 'G473 1S AIO 5A (ELRS встроен)', weight: 3.3, cells: '1S' },
      { id: 'fc_hm_diamond', name: 'Happymodel Diamond F4 1S AIO ELRS', weight: 3.3, cells: '1S' },
      { id: 'fc_hm_x12', name: 'Happymodel X12 1S AIO ELRS (5A)', weight: 3.4, cells: '1S' },
      { id: 'fc_nbd_beebrain', name: 'NBD BeeBrain BLV5 ELRS AIO', weight: 4.9, cells: '1S', gyro: 'mpu6000', note: 'флагманская' },
      { id: 'fc_nbd_hummingbird', name: 'NBD Hummingbird V4 ELRS AIO (12A Bluejay)', weight: 4.6, cells: '1S', gyro: 'bmi270' },
      // 2S
      { id: 'fc_f405_12a', name: 'F405 2S AIO 12A', weight: 5.6, cells: '2S', note: 'для тяжёлых 75мм 2S' },
    ],
  },
  {
    id: 'camera',
    title: 'Камера',
    required: true,
    items: [
      { id: 'cam_c03', name: 'BetaFPV C03 (в комплекте)', weight: 1.6 },
      { id: 'cam_ant', name: 'Caddx Ant Nano', weight: 2.0 },
      { id: 'cam_foxeer_pred5', name: 'Foxeer Nano Predator 5', weight: 2.0, note: 'низкая задержка' },
      { id: 'cam_hdzero_eco', name: 'HDZero ECO', weight: 3.2, note: 'цифра HDZero, бюджетная' },
      { id: 'cam_hdzero_lux', name: 'HDZero Lux', weight: 3.4, note: 'цифра HDZero' },
      { id: 'cam_hdzero_nano_v2', name: 'HDZero Nano V2', weight: 2.3, note: 'цифра HDZero' },
      { id: 'cam_hdzero_nano_v3', name: 'HDZero Nano V3', weight: 2.9, note: 'цифра HDZero' },
      { id: 'cam_nbd_beeeye', name: 'NBD BeeEye', weight: 1.9 },
      { id: 'cam_atom', name: 'RunCam Atom 14мм', weight: 1.7 },
      { id: 'cam_nano3', name: 'RunCam Nano 3', weight: 1.5 },
      { id: 'cam_racer_nano2', name: 'RunCam Racer Nano 2', weight: 1.6, note: 'гоночная WDR' },
    ],
  },
  {
    id: 'vtx',
    title: 'Видеопередатчик',
    required: true,
    items: [
      { id: 'vtx_m03', name: 'BetaFPV M03 5.8G', weight: 1.4 },
      { id: 'vtx_hdzero_aio5', name: 'HDZero AIO 5 (FC+VTX)', weight: 4.0, cells: '1S', note: 'цифра HDZero' },
      { id: 'vtx_hdzero_aio15', name: 'HDZero AIO 15 (FC+VTX)', weight: 4.6, cells: '2S', note: 'цифра HDZero' },
      { id: 'vtx_hdzero_eco', name: 'HDZero ECO VTX', weight: 3.0, note: 'цифра HDZero, бюджетная' },
      { id: 'vtx_hdzero_whooplite', name: 'HDZero Whoop Lite (whooplite)', weight: 1.9, cells: '1S', note: 'цифра HDZero' },
      { id: 'vtx_hdzero_whoop_v2', name: 'HDZero Whoop VTX V2', weight: 3.4, note: 'цифра HDZero, 1S/2S' },
      { id: 'vtx_nbd_smartmax', name: 'NBD SmartMax 400mW (nano)', weight: 2.0 },
      { id: 'vtx_nano', name: 'Внешний nano 25–400mW', weight: 1.8 },
      { id: 'vtx_none', name: 'Встроен в плату / нет', weight: 0 },
    ],
  },
  {
    id: 'receiver',
    title: 'Приёмник',
    required: true,
    items: [
      { id: 'rx_elrs_nano', name: 'ELRS Nano (внешний)', weight: 0.7 },
      { id: 'rx_tbs_nano', name: 'TBS Crossfire Nano', weight: 1.2 },
      { id: 'rx_builtin', name: 'Встроен в плату (ELRS)', weight: 0 },
    ],
  },
  {
    id: 'battery',
    title: 'Аккумулятор',
    required: true,
    items: [
      { id: 'b_260', name: '1S 260mAh HV', weight: 7.0, cells: '1S' },
      { id: 'b_300hv', name: '1S 300mAh HV (BT2.0)', weight: 8.1, cells: '1S' },
      { id: 'b_lava2_320', name: 'BetaFPV LAVA II 1S 320mAh 95C', weight: 8.2, cells: '1S', note: 'Lava 2, Z-Folding' },
      { id: 'b_tattu_300', name: 'Tattu 1S 300mAh 75C HV (BT2.0)', weight: 8.1, cells: '1S' },
      { id: 'b_tattu_rline300', name: 'Tattu R-Line 1S 300mAh 95C', weight: 8.0, cells: '1S', note: 'гоночная серия' },
      { id: 'b_dogcom_300', name: 'Dogcom 1S 300mAh 75C HV BT2.0', weight: 8.3, cells: '1S' },
      { id: 'b_380', name: '1S 380mAh HV', weight: 9.6, cells: '1S' },
      { id: 'b_450', name: '1S 450mAh', weight: 11.2, cells: '1S' },
      { id: 'b_tattu_450', name: 'Tattu 1S 450mAh 95C HV (BT2.0)', weight: 10.8, cells: '1S' },
      { id: 'b_530', name: '1S 530mAh HV (для 75мм)', weight: 12.8, cells: '1S' },
      { id: 'b_550', name: '1S 550mAh HV (для 75мм)', weight: 13.6, cells: '1S' },
      { id: 'b_lava2_580', name: 'BetaFPV LAVA II 1S 580mAh 95C', weight: 13.8, cells: '1S', note: 'Lava 2, для 75мм' },
      { id: 'b_2s300', name: '2S 300mAh (для 75мм 2S)', weight: 17.4, cells: '2S' },
    ],
  },
  {
    id: 'canopy',
    title: 'Канопа',
    required: true,
    items: [
      { id: 'can_goober', name: 'NBD Goober v2', weight: 1.4, note: 'с камерой 14мм' },
      { id: 'can_none', name: 'Без канопы', weight: 0 },
      { id: 'can_tpu', name: 'Лёгкая TPU', weight: 0.6 },
      { id: 'can_stock', name: 'Стоковая', weight: 1.0 },
    ],
  },
]

export const DEFAULT_SELECTION: { [k: string]: string } = {
  frame: 'f65_meteor',
  motor: 'm0802_22000',
  prop: 'p31_gemfan1210',
  fc: 'fc_f4_5a',
  camera: 'cam_c03',
  vtx: 'vtx_none',
  receiver: 'rx_builtin',
  battery: 'b_300hv',
  canopy: 'can_stock',
}

export function getComponent(cat: Category, id: string): Component | null {
  const c = CATEGORIES.find((x) => x.id === cat)
  return c ? c.items.find((x) => x.id === id) || null : null
}
