// js/login.js
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const errorMessageElement = document.getElementById('error-message');

    // Supabase 클라이언트가 로드되었는지 확인
    if (typeof supabase === 'undefined') {
        console.error('Supabase client is not loaded. Make sure supabaseClient.js is included before login.js.');
        if (errorMessageElement) {
            errorMessageElement.textContent = '오류: 애플리케이션 초기화에 실패했습니다. supabaseClient.js를 확인해주세요.';
        }
        return;
    }

    // 페이지 로드 시 이미 세션이 있는지 확인
    supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
            console.log('활성 세션이 존재합니다. index.html로 리디렉션합니다.');
            window.location.href = 'index.html';
        }
    }).catch(error => {
        console.error('세션 확인 중 오류 발생:', error);
        if (errorMessageElement) {
            errorMessageElement.textContent = '세션 확인 중 오류가 발생했습니다. 페이지를 새로고침 해주세요.';
        }
    });

    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (errorMessageElement) errorMessageElement.textContent = ''; // 이전 오류 메시지 지우기

            const email = loginForm.email.value;
            const password = loginForm.password.value;

            if (!email || !password) {
                if (errorMessageElement) errorMessageElement.textContent = '이메일과 비밀번호를 모두 입력해주세요.';
                return;
            }

            try {
                console.log(`로그인 시도: ${email}`);
                const { data, error } = await supabase.auth.signInWithPassword({
                    email: email,
                    password: password,
                });

                if (error) {
                    console.error('로그인 오류:', error);
                    if (errorMessageElement) {
                        if (error.message.includes('Invalid login credentials')) {
                            errorMessageElement.textContent = '이메일 또는 비밀번호가 잘못되었습니다.';
                        } else if (error.message.includes('Email not confirmed')) {
                            errorMessageElement.textContent = '이메일 인증이 필요합니다. 받은편지함을 확인해주세요.';
                        }
                         else {
                            errorMessageElement.textContent = `로그인 실패: ${error.message}`;
                        }
                    }
                } else if (data.user) {
                    console.log('로그인 성공:', data.user);
                    // 사용자의 추가 정보(예: 회사 biz_no)를 가져오는 로직이 필요하다면 여기서 처리 후 리디렉션
                    // 지금은 바로 index.html로 리디렉션
                    window.location.href = 'index.html';
                } else {
                    // 이론적으로 발생하기 어려운 케이스 (오류도 없고 사용자 정보도 없는 경우)
                     console.warn('로그인 후 사용자 정보가 없습니다. 응답:', data);
                     if (errorMessageElement) errorMessageElement.textContent = '로그인에 성공했으나 사용자 정보를 가져오지 못했습니다.';
                }
            } catch (exception) {
                console.error('로그인 처리 중 예외 발생:', exception);
                if (errorMessageElement) errorMessageElement.textContent = '로그인 중 예기치 않은 오류가 발생했습니다.';
            }
        });
    } else {
        console.error('Login form not found in login.html');
        if (errorMessageElement) {
            // login.html 자체에 문제가 있을 가능성
            errorMessageElement.textContent = '로그인 폼을 찾을 수 없습니다. 페이지 구성에 문제가 있을 수 있습니다.';
        }
    }
});

function getSearchSuggestions(keyword) {
    const kw = keyword.trim().toLowerCase().replace(/\s/g, '');
    if (kw.length < 2) return [];
    if (!window.searchCompanyList || window.searchCompanyList.length === 0) return [];
    return window.searchCompanyList.filter(n => {
        if (!n) return false;
        const name = (n.company_name || '').toLowerCase().replace(/\s/g, '');
        const bizNo = (n.biz_no || '').replace(/-/g, '');
        const ceo = (n.ceo_name || '').toLowerCase().replace(/\s/g, '');
        return (
            name.includes(kw) ||
            bizNo.includes(kw.replace(/-/g, '')) ||
            ceo.includes(kw)
        );
    });
} 