# Amazon Appstore Publishing Guide — SMARAN.AI

This guide provides the complete, step-by-step production instructions for publishing **SMARAN.AI** (`ai.smaran.app`) to the **Amazon Appstore** (covering Amazon Fire tablets, Fire OS, and all compatible Android devices worldwide).

---

## 1. Application Profile Summary

| Field | Value |
|---|---|
| **App Title** | `SMARAN.AI — Private AI Assistant` |
| **Package / Application ID** | `ai.smaran.app` |
| **Version Name** | `1.0.0` |
| **Version Code** | `10000` |
| **Category** | Productivity / Developer Tools / Utilities |
| **Supported OS** | Android 7.0 (Nougat) to Android 15 / Fire OS 7+ |
| **Default Language** | English |
| **Price** | Free ($0.00) — No in-app purchases, no subscriptions |
| **Privacy Policy URL** | `https://smaran-ai.netlify.app/#privacy` |
| **Terms of Service URL** | `https://smaran-ai.netlify.app/terms.html` |
| **Support Website** | `https://smaran-ai.netlify.app/` |

---

## 2. Prerequisites & Preparation

### A. Amazon Developer Account
1. Visit the [Amazon Developer Console](https://developer.amazon.com/apps-and-games).
2. Sign in with your Amazon credentials or register as an independent developer (**Shashwat Mishra**). Registration is **free** (Amazon does not charge an annual fee like Apple).
3. Complete the Developer Identity profile (Company/Developer Display Name: `Shashwat Mishra`).

### B. Production APK File
- The production APK is built from [`frontend/android`](file:///c:/Users/shash/Desktop/SMARAN.AI/frontend/android).
- You can use the already compiled and tested APK:
  - File: `SMARAN-AI.apk`
  - Download URL: `https://github.com/SHASHWAT-MISHRA-997/SMARAN.AI-downloads/releases/latest/download/SMARAN-AI.apk`
  - Architecture: Universal ARM64 / ARMv7 / x86_64.
  - Signatures: Includes both v1 (JAR) and v2 (Full APK Signature) schemes to guarantee compatibility across all Fire OS and Android package installers.

---

## 3. Step-by-Step Submission in Amazon Developer Console

### Step 1: Add New App
1. Go to **Dashboard** &rarr; **Add New App** &rarr; Select **Android**.
2. **App Title**: `SMARAN.AI — Private AI Assistant`
3. **App SKU**: `smaran-ai-android`
4. Click **Save**.

---

### Step 2: App Information Tab
Fill in the general information:
- **Application Category**: `Productivity` (or `Utilities`).
- **Support Contact Details**:
  - Email: Your developer email.
  - Website: `https://smaran-ai.netlify.app/`
- **Privacy Policy URL**: `https://smaran-ai.netlify.app/#privacy`
- **Terms of Service URL**: `https://smaran-ai.netlify.app/terms.html`

---

### Step 3: Target Device Support
1. In the **Target Your App** tab, choose:
   - **Amazon Fire Tablets**: Select all supported Fire tablets (Fire HD 8, Fire HD 10, Fire Max 11).
   - **Non-Amazon Android Devices**: Check **Yes** (this allows Samsung, Google Pixel, Xiaomi, OnePlus, and any Android device using the Amazon Appstore to download SMARAN.AI).
2. Export compliance: Select **No** (standard open-source encryption / SSL HTTPS).

---

### Step 4: Upload APK Files
1. Go to the **Upload Your App Files** tab.
2. Drag and drop `SMARAN-AI.apk`.
3. Amazon will automatically scan the package:
   - Package verification: `ai.smaran.app`
   - Version code: `10000`
   - Permissions: Local Network, Audio Record (for voice speech recognition), Storage (for local models).
4. Check the box confirming that you have the right to distribute the application.

---

### Step 5: Description & Keywords
- **Short Description** (up to 120 chars):
  > Sovereign artificial intelligence running on your own machine. 100% private, zero cloud tracking, local speech & chat.
- **Long Description**:
  ```text
  SMARAN.AI is your private, autonomous AI companion that runs directly on your own hardware without renting cloud models or surrendering your privacy.

  KEY CAPABILITIES:
  • 100% Sovereign & Private: Your prompts, memories, and documents are processed locally. Zero corporate tracking.
  • Voice & Offline Speech: Instant, real-time voice speech recognition and natural neural voice playback.
  • Device Pairing: Seamlessly connect your Android device with your SMARAN Desktop workstation over local LAN for continuous memory and shared history.
  • Open Model Compatibility: Supports DeepSeek R1, Qwen 2.5 Coder, Llama 3.2, and Whisper engines.
  • MIT Licensed & Free: Completely free with zero subscriptions, paywalls, or advertisements.
  ```
- **Keywords / Search Tags**:
  `AI, Artificial Intelligence, Private AI, Offline Assistant, Voice Assistant, DeepSeek, Llama, Qwen, Productivity, Local LLM`

---

### Step 6: Images & Multimedia Assets
Prepare and upload the following graphic assets:

1. **Large App Icon**:
   - Dimensions: `512 x 512 px`
   - Format: PNG with transparency (use `website/assets/logo.png`).
2. **Promotional Banner**:
   - Dimensions: `1024 x 500 px`
   - Format: PNG / JPEG (landscape presentation of the SMARAN emblem).
3. **Screenshots**:
   - At least 3 screenshots (phone or tablet ratio, e.g. `1080 x 1920 px` or `1280 x 800 px`).
   - Use the verified screenshots from the root directory:
     - `phone_live_verified.png` (Live chat & status)
     - `phone_memory_toggles.png` (Memory & privacy controls)
     - `phone_tools.png` (Model capabilities & tools)

---

### Step 7: Content Rating Questionnaire
Answer the automated questionnaire:
- Violence: None
- Nudity / Sexual Content: None
- Gambling: None
- User-to-User Communication: None (Single-user private local assistant)
- Personal Data Shared: None (100% local processing)
- Result: **All Ages** or **Low Maturity** (Recommended rating: `Teen` or `General Audiences` due to general conversational AI capability).

---

### Step 8: Review & Submit
1. Review all green checkmarks across the tabs:
   - App Information: Complete
   - Target Your App: Complete
   - Upload App Files: Complete
   - Description: Complete
   - Images & Multimedia: Complete
   - Content Rating: Complete
2. Click **Submit App**.
3. Typical review time on the Amazon Appstore is **24 to 48 hours**. You will receive an automated email confirmation once your app goes live on the Amazon Appstore catalog!
