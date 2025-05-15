// js/supabaseClient.js

// Supabase 프로젝트 URL 및 anon 키를 입력하세요.
const SUPABASE_URL = 'https://lyvaymcduleqtbyxnvjw.supabase.co';       // 실제 Supabase 프로젝트 URL로 교체
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5dmF5bWNkdWxlcXRieXhudmp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcxNDU2OTAsImV4cCI6MjA2MjcyMTY5MH0.4nky51r36hZEjdYSu9RbLGwt0fnEzRAQ9PzI10TjpIM'; // 실제 Supabase 프로젝트 Anon 키로 교체

let supabase; // supabase 변수를 여기서 선언합니다.

try {
    if (!SUPABASE_URL || SUPABASE_URL === 'YOUR_SUPABASE_URL') {
        throw new Error('Supabase URL을 설정해야 합니다.');
    }
    if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
        throw new Error('Supabase Anon Key를 설정해야 합니다.');
    }

    // Supabase V2 CDN (<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>) 사용 시
    // 전역 객체는 `supabase` (소문자)로 생성됩니다. (supabase.createClient)
    // 이전에는 window.supabase 였으나, @supabase/supabase-js v2 부터는 전역 supabase 객체에 createClient가 직접 있습니다.
    // 라이브러리 로드 확인
    if (typeof supabase === 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
        // window.supabase가 supabase 라이브러리 객체 자체를 가리키므로,
        // supabase 변수에 createClient 함수를 할당하는 것이 아니라, createClient() 호출 결과를 할당해야 합니다.
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } else if (typeof supabase !== 'undefined' && typeof supabase.createClient === 'function') {
        // 만약 supabase 전역 변수가 이미 라이브러리 객체라면 (일부 환경/로드 방식)
        supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    else {
        throw new Error('Supabase JS Client 라이브러리가 제대로 로드되지 않았거나 버전(@supabase/supabase-js@2)이 호환되지 않습니다. index.html의 CDN 스크립트를 확인하세요.');
    }

    if (!supabase) {
        throw new Error('Supabase 클라이언트 객체 생성에 실패했습니다.');
    }

} catch (error) {
    console.error("Supabase 클라이언트 초기화 오류:", error.message);
    // 사용자에게 더 친절한 메시지를 보여주는 것이 좋습니다.
    // 예를 들어, body에 직접 오류 메시지를 삽입하거나, 특정 div에 표시할 수 있습니다.
    document.body.innerHTML = '<div style="color: red; padding: 20px; text-align: center; font-size: 1.2em;">' +
                              '애플리케이션 설정 오류: Supabase 클라이언트를 초기화할 수 없습니다. <br>' +
                              '콘솔(F12)에서 자세한 오류를 확인하고, 관리자에게 문의하세요. <br>' +
                              'js/supabaseClient.js 파일의 URL 및 Key 값을 확인해주세요.</div>';
}

// main.js에서 supabase 변수를 사용할 수 있도록 합니다.
// (모듈 시스템을 사용하지 않으므로, supabaseClient.js가 main.js보다 먼저 로드되면 전역 스코프에서 접근 가능)
// supabase 변수는 이미 이 스크립트의 최상위 스코프에 선언되어 있으므로 별도의 export 불필요. 