# Upstage — 인공지능 챔피언/루키 대회

> Upstage · Seungwon Cheon / NFM 센터 · © 2025 Upstage Co., Ltd.

---

## 목차

1. [About Upstage](#1-about-upstage)
2. [Products — Solar LLM](#2-products--solar-llm)
3. [Products — Document Parse](#3-products--document-parse)
4. [Products — Information Extract](#4-products--information-extract)
5. [API Usage Guide — Upstage Product User Guide](#5-api-usage-guide--upstage-product-user-guide)

---

## 1. About Upstage

### 제품 라인업 개요

'**Making AI Beneficial**' 비전 아래, OCR에서 LLM까지 **Full Stack 자체 개발 역량**을 보유하고 있습니다. 창립 이래 100명 이상의 엔지니어가 활발히 모델을 개발하고 제품을 출시하고 있습니다.

#### 연도별 제품 출시 타임라인

| 연도 | Document Processing | Large Language Models | Product Releases |
|------|--------------------|-----------------------|-----------------|
| 2022 | Document OCR | | AskUp |
| 2023 | Document Parse | Solar 10.7B | WriteUp |
| 2024 | Information Extract, Document Classify | Solar Mini, Solar Pro | EditUp |
| 2025 | | Solar Pro 2 | Upstage Studio, AI Space |
| 2026 | | Solar Open, Solar Pro 3 | |

---

### 숫자로 증명하는 엔터프라이즈 규모의 검증된 성과

| 지표 | 수치 |
|------|------|
| **연간 매출** (2024) | $20M |
| **일일 자동화 처리 페이지** | 3M+ |
| **국내 보험 청구 처리** | 70% |
| **글로벌 기업 고객** | 100+ |
| **AI 엔지니어** | 100+ |
| **투자 유치** (AWS, AMD 등 탑티어) | $150M |

---

### 세계 최고의 AI 혁신 기업으로 선정

CB Insights에서 **foundation models, workflow automation, cross-functional platforms** 분야에서 선정되었습니다.

| 인증 | 분야 | 연도 |
|------|------|------|
| CB Insights AI 100 | Foundation Models | 2025 |
| CB Insights Fintech 100 | Workflow Automation | 2025 |
| CB Insights Insurtech 50 | Cross-functional Platforms | 2025 |

---

### AWS Marketplace 최상위 랭킹

**Upstage Document AI**는 AWS Marketplace에서 전 세계 인기 솔루션 **2위**입니다.
*(as of Feb 24, 2026 — https://aws.amazon.com/marketplace)*

---

## 2. Products — Solar LLM

### Solar Pro 3

> Mixture-of-Experts (MoE) 기반 독자 파운데이션 모델 (102B, 2026년 1월 출시)
> **"두 배 강력해진 에이전트 성능, Solar Pro 3를 만나보세요."**

#### 모델 주요 특징

| 항목 | 내용 |
|------|------|
| **모달리티** | 순수 LLM (텍스트 전용) |
| **아키텍처** | MoE(Mixture-of-Experts): 총 102.6B / 활성 12B |
| **학습** | 19.7조 토큰 사전학습, NVIDIA B200 GPU, From Scratch |
| **컨텍스트** | 128K 토큰 |
| **한국어** | 딥시크R1 대비 한국어 2배+, 영어·일본어도 상회 |

#### Solar Pro 3 주요 성과

**에이전트 성능, 두 배 상승**
Tau2-all에서 Solar Pro 3는 72.3점으로 Solar Pro 2의 36점 대비 **+101% 상승**

**추론 능력 강화**
자체 개발 강화학습 프레임워크 **SnapPO** 적용을 통한 멀티스텝 계획 유지, 오류 자기감지, 모호한 상황 판단 능력 향상

**지속적인 한국어 성능 투자**
Ko-Arena-hard-v2에서 **78.2**를 기록해 Solar Pro 2의 66.6점을 넘어섬

#### Solar Pro 2 → Solar Pro 3 벤치마크 비교

| 평가 항목 | Solar Pro 2 | Solar Pro 3 | 향상률 |
|---------|------------|------------|-------|
| Tau2-all (에이전트) | 36.0 | 72.3 | +101% |
| AIME'26 (추론) | 71.0 | 83.0 | +17% |
| Arena-hard-v2 (선호도) | 50.8 | 74.7 | +47% |
| Ko-Arena-hard-v2 (한국어) | 66.6 | 78.2 | +17% |

---

## 3. Products — Document Parse

> **LLM이 문서를 처리할 수 있게 변환**

### Document Parse가 왜 필요한가?

LLM은 파일이 아닌 **텍스트**를 처리하기 때문에, LLM으로 복잡한 문서를 다루려면 Document Parse가 필수입니다.

### Document Parse의 기능

Document Parse는 PDF, 스캔 이미지(예: tiff, jpeg), Microsoft Office 문서(예: xlsx, pptx) 등 **어떤 문서든 HTML 또는 Markdown으로 변환**합니다.

### 동종 제품 대비 성능 비교

> Document Parse는 동종 제품 중 **가장 높은 정확도와 속도**를 보여줍니다. 특히 처리량이 증가할 때 더욱 두드러집니다.
> *(Measured on dp-bench public dataset on HuggingFace — Last updated Mar 2026)*

| 제품 | TEDS ↑ | TEDS-S ↑ | NID ↑ | Avg Time ↓ (sec.) |
|------|--------|---------|-------|------------------|
| **Upstage Document Parse** | **96.06** | **97.25** | **96.29** | **3.77** |
| Amazon Textract | 95.48 | 96.99 | 95.97 | 7.95 |
| LlamaParse | 90.73 | 76.34 | 90.53 | 10.88 |
| Unstructured | 80.26 | 89.52 | 91.78 | 6.80 |
| Google Layout Parser | 78.30 | 78.30 | 82.17 | 37.00 |
| Azure AI Document Intelligence | 77.85 | 85.74 | 87.03 | 4.44 |

> TEDS: 텍스트 및 표 구조 인식 / TEDS-S: 표 구조 인식 / NID: 텍스트 및 레이아웃 구조 인식

### 내부 파이프라인 구조

Document Parse는 **파일 변환기 + OCR 모델 + 레이아웃 분석기**로 구성된 파이프라인입니다.

```
Document (PDF, MS Office, image)
        ↓
  Upstage OCR / PDF parser
        ↓
  [ 텍스트 인식 모듈 ]          [ 레이아웃 분석 모듈 ]
  Detector                      Reading Order Extractor
  Heading Level Recognizer      Layout Table Recognizer
  ...                           Layout Chart Recognizer
        ↓                              ↓
              Layout + Text Merge
                      ↓
        Final Results (HTML or Markdown)
```

- 정확한 정보 추출을 위해 단순히 텍스트를 읽는 것만으로는 부족
- 차트, 표 등의 요소를 포함한 **레이아웃 이해** 필수
- Upstage Document Parse는 문서 구조를 분석하여 HTML 또는 Markdown으로 렌더링

---

## 4. Products — Information Extract

> **Universal information extraction**

### 정보 추출이란?

비정형 문서를 대량으로 **정형 데이터로 변환**하여 분석과 자동화를 가능하게 합니다.

**예시 — Commercial Invoice 입력 시 추출 결과:**

| Key | Value |
|-----|-------|
| `document_information.document_name` | COMMERCIAL INVOICE |
| `document_information.invoice_issuance_date` | JAN-04-2019 |
| `shipping_information.shipper_name` | HWA SOO CO., LTD. |
| `shipping_information.shipper_address` | 56, YEOUIDO-DONG, YEON |
| `shipping_information.consignee_name` | SAKURA TRADING CO., LTD |
| `shipping_information.consignee_address` | 1 CHOME 1-1, MARUNOUCHI |

---

### 고정밀 OCR에서 범용 LLM 에이전트로

독보적인 OCR 기술력에 LLM을 더해, 다양한 산업의 니즈를 완벽히 해결하는 정보 추출 솔루션을 제공합니다.

| 구분 | 전통적인 OCR 기반 모델 | Upstage Information Extract |
|------|---------------------|---------------------------|
| 방식 | 문서 유형별 개별 모델 필요 | **단일 LLM 기반 에이전틱 파이프라인** |
| 대응 범위 | 송장, 견적서, 신청서 각각 별도 | **모든 문서 유형에서 정보 추출** |

---

### Information Extract는 기존 OCR과 다른가요?

기존 OCR 모델과 달리 Information Extract는 **의미를 이해하고 어떤 문서에도 즉시 적응**합니다.

| 차별점 | 설명 |
|--------|------|
| **단순 텍스트 인식이 아닌 맥락과 의도를 이해** | 명시적으로 작성된 내용뿐 아니라 항목별 합계나 의도를 나타내는 라벨 없는 세부 사항 등 암시된 내용까지 추출 |
| **문서 디자인이 달라도 일관된 스키마 추출** | 주어진 스키마에 맞춰 동적으로 구조화된 출력을 생성할 수 있어, 다양한 사용 사례에 맞는 맞춤형 처리 가능 |
| **모든 문서 유형에 대응** | 스캔 이미지, PDF, Office 파일, 회전된 페이지, 심지어 500페이지 이상의 문서까지 처리 |

---

### 범용 LLM과 성능 비교

> Information Extract는 **범용 LLM 대비 10% 이상 높은 성능**을 제공하며, 추가 튜닝 없이도 에지 케이스를 안정적으로 처리합니다.
> *(마지막 업데이트: 2025년 12월)*

| 모델 | 정확도 KIEval-4.0* ↑ | 지연 시간 (per doc) ↓ | 가격 (per page) ↓ |
|------|--------------------|--------------------|-----------------|
| OpenAI GPT-4.1 | 73.65 | 15.48s | $0.006 |
| Anthropic Claude Sonnet 4.5 | 63.66 | 16.13s | $0.017 |
| Google Gemini 2.5 Flash | 76.59 | 35.68s | $0.004 |
| Google Gemini 2.5 Pro | 77.77 | 37.92s | $0.020 |
| Alibaba Qwen 2.5 VL 72B | 68.60 | 41.83s | $0.011 |
| **Upstage Information Extract** | **78.32** | **7.50s** | $0.040 |

---

### 전통적인 OCR 모델 대비 실질 운영 비용 비교

기업은 정확도, 지연 시간, 추론 비용에 집중하지만, 배포와 지속적 유지보수에 따른 숨겨진 운영 비용을 간과하는 경우가 많습니다.

| 항목 | 전통적인 OCR 모델 | Upstage Information Extract |
|------|----------------|---------------------------|
| **정확도** | 90%+ | 90%+ |
| **지연 시간** | ~3초/장 | ~3초/장 |
| **추론 비용** (반복발생) | 60원/장 | 60원/장 |
| **학습 비용** (일회성) | 데이터 사이언티스트 2MM (데이터 수집, 모델 학습) | **Zero training** — 간단한 스키마 설계로 즉시 배포 |
| **유지보수** (정기적) | 데이터 사이언티스트 1MM (모델 학습) | **누구나 약 1일 시간** |

---

### 뛰어난 성능을 위한 내부 구조

문서 **router, parser, extractor, validator**로 구성된 에이전틱 파이프라인입니다.

```
Document ──→ Document Router ──→ Sub-pipeline 1 (DP + LLM based IE) ──→ Intermediate IE Results ──→ Validator ──→ Final IE Results
Schema  ──→                  └→ Sub-pipeline 2
                              └→ ...
```

- 성능 및 컴플라이언스 요구사항에 따라 **최적의 LLM을 선택**
- **자체 LLM을 연동** 가능 (Bring Your Own LLM)
- SaaS 옵션의 경우, 기술이 발전함에 따라 파이프라인을 **지속적으로 업그레이드**

---

## 5. API Usage Guide — Upstage Product User Guide

> Solar LLM, Document Parse, Information Extract API를 실제 서비스에 적용하는 방법을 단계별로 배우는 **실습 강의와 교재 제공**

**강의 링크**: https://edu.upstage.ai/course/upstage-user-guide-api

### 커리큘럼 구성

| 챕터 | 내용 |
|------|------|
| **1. API User Guide** | Introduction to Upstage API |
| **2. Solar LLM API** | Solar Chat, Solar Embedding, Structured Outputs, Function Calling |
| **3. Document AI API** | Getting Started with Document AI |
| **4. No Code Document Agent: Studio** | Getting Started with Upstage Studio |

---

### Chapter 1 — Solar Chat API

**2.1 단일 질문 (Single-turn Chat)**

가장 기본적인 사용 방식. 한 번의 질문과 응답으로 구성됩니다.
- 단일 질문 구조에서는 사용자 → 모델 → 응답의 한 사이클만 존재
- 모델은 이전 대화의 맥락을 알 수 없고, 단 건으로 주어진 메시지에만 반응

```python
# pip install openai

from openai import OpenAI  # openai==1.52.2

client = OpenAI(
    api_key="up_your_api_key_here",
    base_url="https://api.upstage.ai/v1"
)

stream = client.chat.completions.create(
    model="solar-pro",
    messages=[
        {
            "role": "user",
            "content": "Hi, how are you?"
        }
    ],
    stream=True,
)

for chunk in stream:
    if chunk.choices[0].delta.content is not None:
        print(chunk.choices[0].delta.content, end="")

# Use with stream=False
# print(stream.choices[0].message.content)
```

**다중턴 대화 (Multi-turn Conversation)**

이전 대화 내용을 기억하며 여러 차례 질문/답변을 이어갈 수 있습니다.
- 이전의 대화 맥락을 유지하며 여러 번의 상호작용이 가능
- 모델은 모든 메시지를 참고하여 답변을 생성

```python
from openai import OpenAI  # openai==1.52.2

client = OpenAI(
    api_key="up_****************************p08",
    base_url="https://api.upstage.ai/v1"
)

def chat_with_solar(messages):
    response = client.chat.completions.create(
        model="solar-pro",
        messages=messages
    )
    return response.choices[0].message['content']

# 대화 시작
messages = [{"role": "user", "content": "Hello, who won the world series in ..."}]
response = chat_with_solar(messages)
print("Assistant:", response)
messages.append({"role": "assistant", "content": response})

# 다음 질문
messages.append({"role": "user", "content": "Where was it played?"})
response = chat_with_solar(messages)
print("Assistant:", response)
```

---

### Function Calling이란?

Function Calling은 LLM(Large Language Model)이 외부의 시스템, API, 데이터베이스, 사용자 정의 함수 등과 **직접 연동하여 실제 작업을 수행**할 수 있게 하는 기능입니다.

즉, Function Calling 기능을 통해 LLM은 단순 응답을 넘어 **"상황을 판단하고, 적절한 도구(Function)를 선택하고, 직접 실행"** 하는 능동적인 에이전트가 됩니다.

#### Function Calling 주요 활용 사례

| 활용 | 설명 |
|------|------|
| **1. API 호출 (실시간 정보 연동)** | 모델이 날씨, 환율, 뉴스, 주가 등 실시간 데이터를 외부 API에서 직접 받아올 수 있음 |
| **2. 데이터베이스 쿼리** | 내부 데이터베이스의 구조화된 테이블에 접근하여 정확한 숫자나 기록을 조회 가능 |
| **3. 자동화된 작업 수행** | 업무 자동화 도구(예: Zapier, RPA 등)와 연동하여 일을 직접 처리하는 AI로 활용 가능 |
| **4. 코드 실행** | 모델이 작성한 코드를 실제로 실행 가능한 형태로 전달하고, 그 결과 반환 |

---

### Chapter 3 — Information Extraction API

**Information Extraction 이란?**

비정형 문서에서 핵심 정보를 식별하고 추출하여, 단순한 문서 디지털화를 넘어 **데이터베이스 등 구조화된 형식으로 저장**할 수 있도록 하는 과정입니다.

- 인보이스(세금 계산서) 문서에서 "총 금액", "공급자명", "날짜" 같은 항목
- 신분증에서 "이름", "생년월일" 같은 항목
- 계약서에서 "계약 기간", "계약 담당자", "해지 조건" 등

이 정보들은 회계 시스템, CRM, ERP 등 다른 비즈니스 시스템에 자동으로 입력되어, 수작업 없이 업무를 자동화할 수 있게 됩니다.

**Information Extraction을 언제 활용할까?**

Upstage의 정보 추출 모델은 문서에서 특정 **"키(Key)"** — 즉, 사람이 알고 싶은 데이터 항목(예: 총 금액, 발행일, 계약 자)를 입력하면, 해당 키에 대한 **"값(Value)"** 을 반환합니다. 이러한 방식은 수작업이 많은 기업 문서 업무를 자동화하는 데 최적화되어 있습니다.

| 활용 분야 | 설명 |
|---------|------|
| **데이터 구조화 및 분석** | 양식, 보고서, 비정형 텍스트 등에서 주요 정보를 추출하여 데이터베이스 및 분석 도구와 원활하게 연동 |

---

> **교육 링크**: https://edu.upstage.ai/course/upstage-user-guide-api

*작성일: 2026-05-16*
