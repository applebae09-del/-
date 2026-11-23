/**
 * VocaFlow AI - Google Apps Script 백엔드 (generate.gs)
 * 
 * [설정 안내]
 * 1. Google Apps Script 편집기 좌측 '프로젝트 설정(톱니바퀴)' -> '스크립트 속성'에 아래 속성을 추가하세요.
 *    - 속성: GEMINI_API_KEY
 *    - 값: 발급받은 Google Gemini API 키
 * 2. 배포 -> 새 배포 -> 유형: '웹 앱'으로 배포하면 index.html과 연동됩니다.
 */

const GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * 웹 앱 진입점 (HTML 서비스 렌더링)
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('VocaFlow AI - PDF 어휘 및 유·반의어 퀴즈 생성기')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 스크립트 속성에서 Gemini API 키 가져오기
 */
function getGeminiApiKey_() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('스크립트 속성에 GEMINI_API_KEY가 설정되어 있지 않습니다.');
  }
  return apiKey.trim();
}

/**
 * 1. 일반 텍스트 / PDF 추출 텍스트에서 핵심 어휘 + 유의어·반의어 생성
 * @param {string} rawText - 추출된 원문 텍스트
 * @return {Object} { success: boolean, vocab?: Array, error?: string }
 */
function generateVocabFromText(rawText) {
  try {
    if (!rawText || rawText.trim().length < 2) {
      return { success: false, error: '분석할 텍스트가 비어 있습니다.' };
    }

    const truncatedText = rawText.slice(0, 15000);
    const prompt = [
      '다음 텍스트(PDF 단어장 또는 영어 지문)에서 학습 가치가 높은 핵심 영어 단어(최대 25개)를 추출하세요.',
      '각 단어에 대해 정확한 한국어 뜻(meaning), 시험에 자주 출제되는 대표 유의어(synonyms) 2~3개, 대표 반의어(antonyms) 2~3개를 JSON 배열로 반환하세요.',
      '',
      '텍스트:',
      truncatedText
    ].join('\n');

    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: getVocabResponseSchema_()
      }
    };

    const vocabArray = callGeminiApi_(payload);
    return { success: true, vocab: vocabArray };
  } catch (err) {
    console.error('generateVocabFromText 오류:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 2. 촬영된 사진 또는 스캔본 PDF 이미지(Base64 배열)에서 어휘 + 유의어·반의어 추출 (OCR + 분석)
 * @param {Array<string>} base64Images - JPEG Base64 문자열 배열
 * @return {Object} { success: boolean, vocab?: Array, error?: string }
 */
function generateVocabFromImages(base64Images) {
  try {
    if (!Array.isArray(base64Images) || base64Images.length === 0) {
      return { success: false, error: '전달된 이미지 데이터가 없습니다.' };
    }

    const parts = [
      {
        text: '첨부된 단어장 사진 또는 스캔된 PDF 페이지 이미지에서 학습할 핵심 영어 단어(최대 25개)와 한국어 뜻을 정확히 읽어내고, 각 단어에 어울리는 대표 유의어(synonyms) 2~3개와 반의어(antonyms) 2~3개를 JSON 배열로 반환하세요.'
      }
    ];

    // 최대 5페이지/5장까지 처리
    base64Images.slice(0, 5).forEach(function(b64) {
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: b64
        }
      });
    });

    const payload = {
      contents: [{ role: 'user', parts: parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: getVocabResponseSchema_()
      }
    };

    const vocabArray = callGeminiApi_(payload);
    return { success: true, vocab: vocabArray };
  } catch (err) {
    console.error('generateVocabFromImages 오류:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 3. 외부 공유 링크(URL)에서 단어장 데이터를 가져와 유·반의어 확장
 * @param {string} shareUrl - 공유 URL
 * @return {Object} { success: boolean, vocab?: Array, error?: string }
 */
function fetchAndAnalyzeShareUrl(shareUrl) {
  try {
    const response = UrlFetchApp.fetch(shareUrl, {
      muteHttpExceptions: true,
      followRedirects: true
    });

    if (response.getResponseCode() !== 200) {
      return { success: false, error: '링크 페이지에 접근할 수 없습니다. (HTTP ' + response.getResponseCode() + ')' };
    }

    const html = response.getContentText();
    // Next.js __NEXT_DATA__ JSON 우선 탐색
    const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    let extractedSource = '';

    if (nextMatch && nextMatch[1]) {
      extractedSource = nextMatch[1];
    } else {
      // HTML 태그 제거 후 본문 텍스트 추출
      extractedSource = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    if (!extractedSource || extractedSource.length < 15) {
      return { success: false, error: '링크 페이지에서 단어 데이터를 찾지 못했습니다.' };
    }

    return generateVocabFromText(extractedSource);
  } catch (err) {
    console.error('fetchAndAnalyzeShareUrl 오류:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Gemini API 공통 호출 및 재시도 헬퍼
 */
function callGeminiApi_(payload) {
  const apiKey = getGeminiApiKey_();
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + apiKey;

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  let delay = 1000;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    const bodyText = res.getContentText();

    if (code === 200) {
      const json = JSON.parse(bodyText);
      const rawContent = json && json.candidates && json.candidates[0] &&
                         json.candidates[0].content && json.candidates[0].content.parts &&
                         json.candidates[0].content.parts[0] && json.candidates[0].content.parts[0].text;
      if (!rawContent) {
        throw new Error('Gemini API로부터 유효한 응답 텍스트를 받지 못했습니다.');
      }
      const parsed = JSON.parse(rawContent);
      if (!Array.isArray(parsed)) {
        throw new Error('응답 데이터가 배열 형식이 아닙니다.');
      }
      return parsed;
    }

    if (attempt === 2) {
      throw new Error('Gemini API 호출 실패 (HTTP ' + code + '): ' + bodyText);
    }
    Utilities.sleep(delay);
    delay *= 2;
  }
}

/**
 * Gemini Structured Output 응답 스키마 정의
 */
function getVocabResponseSchema_() {
  return {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        word: { type: 'STRING' },
        meaning: { type: 'STRING' },
        synonyms: { type: 'ARRAY', items: { type: 'STRING' } },
        antonyms: { type: 'ARRAY', items: { type: 'STRING' } }
      },
      required: ['word', 'meaning', 'synonyms', 'antonyms']
    }
  };
}