# 小米 SU7 3D 交互旗舰展示网站 (Xiaomi SU7 3D Showcase)

> 基于 **Three.js**、**TypeScript** 与 **Vite** 构建的高拟真小米 SU7 3D Web 可视化交互展厅与动态试驾系统。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Three.js](https://img.shields.io/badge/Three.js-r186-black.svg)
![Vite](https://img.shields.io/badge/Vite-5.4-purple.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-7.0-blue.svg)

---

## 🌟 核心特性

- 🚗 **高精度 3D 轿跑模型**：基于小米 SU7 真实长宽高（4997 × 1963 × 1455 mm）毫米级还原，四轮平整接地。
- 🎨 **官方 9 大全系车漆**：海湾蓝、雅灰、橄榄绿、霞光紫、熔岩橙、珍珠白、钻石黑、流星蓝、寒武岩灰，支持自定义 1600 万色自由调色。
- 🚪 **拟真车门与部件交互**：
  - 4 门独立按真实铰链物理展开/关闭，支持一键展翼与 3D 场景直接点击开闭。
  - 4 档电动升降尾翼（0° 收起 / 5° 低风阻 / 12° 巡航 / 25° 极速下压力）。
- 💡 **全车灯效与座舱系统**：水滴大灯、光环贯穿式尾灯、刹车高亮模式、双闪警示灯、64 色智能座舱环绕氛围灯。
- 🏎️ **动态公路试驾（Drive Mode）**：
  - 真实沥青标线与路灯循环移动公路。
  - 四轮随速自转，前轮转向偏转联动车身微倾。
  - 0-265 km/h 实时数字 HUD 车速表与 P/D 挡位响应。
  - 键盘 [W/A/S/D] 与触控油门/刹车踏板双端适配。
- 🔊 **纯原生 Web Audio 拟真音效**：超级电机随速啸叫声浪、高级车门关合厚重低音、智能解锁和弦、UI 按键音，零外部音频资源依赖。
- 🎥 **电影级多机位镜头**：前 45° 黄金视角、侧颜轿跑、车尾光环、运动轮毂特写、主驾沉浸座舱视角、360° 自动慢速展厅巡航。
- 📋 **车型配置与海报生成**：标准版、Pro 版、Max 版实时参数切换，一键导出专属定制高清海报，预订礼花特效。

---

## 🚀 快速启动

### 1. 安装依赖
```bash
npm install
```

### 2. 启动本地开发服务
```bash
npm run dev
```
本地浏览器访问：`http://localhost:8080/`

### 3. 构建生产包
```bash
npm run build
```
输出静态文件至 `dist/` 目录。

---

## 📖 详细技术架构与实践总结
请参阅详细项目实践文档：[`PROJECT_PRACTICE.md`](./PROJECT_PRACTICE.md)
