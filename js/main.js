document.addEventListener('DOMContentLoaded', async () => {
    // Supabase 클라이언트 초기화 확인
    if (typeof supabase === 'undefined') {
        console.error("Supabase 클라이언트가 초기화되지 않았습니다. js/supabaseClient.js를 확인하세요.");
        // 이 경우, 사용자를 로그인 페이지로 보내거나 심각한 오류 메시지를 표시할 수 있습니다.
        // 여기서는 일단 콘솔 오류만 남기고, initializeApp에서 세션 체크 후 리디렉션합니다.
        // 만약 supabaseClient.js 로드 실패 시 로그인 페이지로도 못 갈 수 있으므로, index.html에 직접적인 메시지 표시 고려.
        const errorDiv = document.createElement('div');
        errorDiv.style.color = 'red'; errorDiv.style.padding = '20px'; errorDiv.style.textAlign = 'center'; errorDiv.style.fontSize = '1.2em';
        errorDiv.textContent = '애플리케이션 설정 오류: Supabase 클라이언트를 로드할 수 없습니다. 관리자에게 문의하세요.';
        document.body.insertBefore(errorDiv, document.body.firstChild);
        return;
    }

    console.log('애플리케이션 시작됨 (main.js). Supabase 클라이언트:', supabase);

    const userSessionControls = document.getElementById('user-session-controls');
    const visualizationContainer = document.getElementById('visualization-container');
    const companyDetailsContainer = document.getElementById('company-details');

    // D3 시각화 관련 주요 변수들 선언
    let simulation, svgInstance, mainViewG;
    let linkElementsSelection, nodeGroupElementsSelection;
    const MAX_DISPLAY_DEPTH = 10;
    const NODE_BASE_RADIUS = 3; // 기본 원 반지름 (위탁업체용)
    const NODE_CHILD_RADIUS_FACTOR = 0.3; // 자식 하나당 반지름 증가량 (위탁업체용)
    const PHARMACY_NODE_FIXED_RADIUS = 32; // 제약사 노드의 고정 반지름

    // 1. 선택된 노드 id를 전역 변수로 관리
    window.selectedNodeId = null;

    // --- 인증 관련 UI 및 함수 (displayUserInfo, fetchUserCompanyBizNo는 유지) ---
    // displayLoginForm, handleLogin 함수는 login.js로 이동되었으므로 여기서는 제거

    function displayUserInfo(user, pharmacyDbInfo) {
        // 사용자 정보를 한 줄로 표시하도록 수정
        const companyName = pharmacyDbInfo?.company_name || '정보 없음';
        const bizNo = pharmacyDbInfo?.biz_no || '정보 없음';
        // 이메일 대신 회사명과 사업자번호를 사용하고, "님, 환영합니다." 문구 추가
        const welcomeMessage = `${companyName} (${bizNo})님, 환영합니다.`;

        userSessionControls.innerHTML = `
            <div id="user-info" style="display: flex; align-items: center; justify-content: flex-end; gap:8px;">
                <span style="margin-right: 10px;">${welcomeMessage}</span>
                <span id="logout-button" style="color:#1976d2; text-decoration:underline; cursor:pointer; font-size:1em; background:none; border:none; padding:0;">로그아웃</span>
            </div>
        `;
        const logoutButton = document.getElementById('logout-button');
        if (logoutButton) {
            logoutButton.addEventListener('click', handleLogout);
        } else {
            console.error("Logout button not found after displaying user info.");
        }
    }

    async function fetchUserCompanyBizNo(userId) {
        try {
            // Step 1: Get user's profile including their biz_no
            const { data: userData, error: userError } = await supabase
                .from('users')
                .select('biz_no, company_name') // company_name from users table
                .eq('id', userId)
                .single();

            if (userError) {
                if (userError.code === 'PGRST116') {
                    console.warn(`사용자 ID ${userId}에 대한 프로필이 users 테이블에 없습니다.`);
                    return null;
                }
                throw userError;
            }
            if (!userData || !userData.biz_no) {
                 console.warn(`사용자 ID ${userId}에 대한 biz_no를 users 테이블에서 찾을 수 없습니다.`);
                 // biz_no가 없더라도 사용자는 존재할 수 있으므로, company_name이라도 반환 시도
                return { biz_no: null, company_name: userData?.company_name || null, ceo: null, address: null };
            }

            // Step 2: Get company details using biz_no from users table
            // 'companies' 테이블에서 ceo_name과 address를 가져옵니다.
            const { data: companyData, error: companyError } = await supabase
                .from('companies')
                .select('company_name, ceo_name, address') // companies 테이블의 컬럼들
                .eq('biz_no', userData.biz_no)
                .single();

            if (companyError) {
                console.warn(`회사 정보를 companies 테이블에서 biz_no ${userData.biz_no}로 찾을 수 없습니다:`, companyError.message);
                // 회사 정보가 없더라도 users 테이블에서 가져온 정보는 반환
                return {
                    biz_no: userData.biz_no,
                    // companies 테이블의 회사명을 우선 사용하고, 없으면 users 테이블의 회사명 사용
                    company_name: companyData?.company_name || userData.company_name,
                    ceo: companyData?.ceo_name || null,
                    address: companyData?.address || null
                };
            }

            // 정상적으로 모든 정보를 가져온 경우
            return {
                biz_no: userData.biz_no,
                // companies 테이블의 회사명을 우선 사용하고, 없으면 users 테이블의 회사명 사용
                company_name: companyData?.company_name || userData.company_name,
                ceo: companyData?.ceo_name || null,
                address: companyData?.address || null
            };

        } catch (error) {
            console.error('사용자 및 회사 정보 조회 오류:', error.message);
            return null; // 최종 오류 발생 시 null 반환
        }
    }

    async function handleLogout() {
        console.log("Attempting logout...");
        const { error } = await supabase.auth.signOut();
        if (error) {
            if (error.message.includes('Auth session missing')) {
                // 세션이 이미 없는 경우에도 로그인 페이지로 이동
                window.location.href = 'login.html';
            } else {
                alert('로그아웃 실패: ' + error.message);
            }
        } else {
            window.location.href = 'login.html';
        }
    }

    // loadPrimaryContractors, formatCompanyName, updateGraph, initializeGraph, drag 함수는 이전과 동일하게 유지
    // (단, 이 함수들이 호출되기 전에 인증 상태가 확인되어야 함)
    async function loadPrimaryContractors(pharmacyInfo) {
        console.log('1차 위탁업체 정보 로딩 중... 제약사 정보:', pharmacyInfo);
        if (!pharmacyInfo || !pharmacyInfo.biz_no) {
            console.error("제약사 정보(biz_no)가 없어 1차 위탁업체를 로드할 수 없습니다.");
            visualizationContainer.innerHTML = '<p style="color:red;">제약사 정보를 확인할 수 없어 데이터를 표시할 수 없습니다. 관리자에게 문의하세요.</p>';
            return;
        }
        visualizationContainer.innerHTML = '<p>데이터 로딩 중...</p>';
        window.pharmacyInfo_source = pharmacyInfo; 

        const { data, error } = await supabase.rpc('get_primary_contractors_for_current_user');

        if (error) {
            console.error('1차 위탁업체 조회 오류:', error.message);
            visualizationContainer.innerHTML = `<p style="color:red;">1차 위탁업체 데이터 로드 실패: ${error.message}</p>`;
            return;
        }
        
        console.log('1차 위탁업체 데이터 (원본):', data);
        // pharmacyInfo에는 이제 ceo와 address도 포함되어 initializeGraph로 전달됩니다.
        await initializeGraph(data || [], pharmacyInfo);
    }

    function formatCompanyName(name) {
        if (!name) return '';
        let formattedName = String(name);

        // 1) "주식회사", "유한회사", "(주)", "(유)" 생략
        // 괄호 안의 (주), (유)도 모두 제거
        const corporates = ["주식회사", "유한회사", "(주)", "(유)"];
        corporates.forEach(corp => {
            const regex = new RegExp(corp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g");
            formattedName = formattedName.replace(regex, "").trim();
        });
        // 추가: 괄호 안에 들어간 (주) 등도 제거
        formattedName = formattedName.replace(/\(.*?\)/g, "").trim();

        // 연속된 공백 제거
        formattedName = formattedName.replace(/\s+/g, "");

        // 6) 7글자 이상이면 4+3/4+4로 줄바꿈
        const len = formattedName.length;
        if (len === 7) {
            formattedName = formattedName.slice(0, 4) + '\n' + formattedName.slice(4);
        } else if (len === 8) {
            formattedName = formattedName.slice(0, 4) + '\n' + formattedName.slice(4);
        }
        // 7글자 미만은 그대로 반환
        return formattedName;
    }

    function getNodeRadius(childrenCount) {
        if (!childrenCount || childrenCount === 0) {
            return 16;
        } else if (childrenCount >= 1 && childrenCount <= 10) {
            return 5 + (childrenCount - 1) * 0.7;
        } else if (childrenCount >= 11 && childrenCount <= 50) {
            return 12 + (childrenCount - 11) * 0.3;
        } else if (childrenCount >= 51 && childrenCount <= 100) {
            return 24 + (childrenCount - 51) * 0.2;
        } else {
            return 34 + (childrenCount - 101) * 0.1;
        }
    }

    function getContractorFillColor(childrenCount) {
        if (!childrenCount || childrenCount === 0) return "#B0BEC5";
        if (childrenCount <= 10) return "#8DB3D3";
        if (childrenCount <= 50) return "#8DB3D3";
        if (childrenCount <= 100) return "#8DB3D3";
        return "#8DB3D3";
    }

    function getContractorFillOpacity(childrenCount) {
        if (!childrenCount || childrenCount === 0) return 0.0;
        if (childrenCount <= 10) return 1.0;
        if (childrenCount <= 50) return 1.0;
        if (childrenCount <= 100) return 1.0;
        return 1.0;
    }

    function getContractorStrokeColor(childrenCount) {
        if (!childrenCount || childrenCount === 0) return "#888";
        if (childrenCount <= 10) return "#888";
        if (childrenCount <= 50) return "#888";
        if (childrenCount <= 100) return "#888";
        return "#888";
    }

    function getContractorStrokeWidth(childrenCount) {
        if (!childrenCount || childrenCount === 0) return 1;
        if (childrenCount <= 10) return 1;
        if (childrenCount <= 50) return 1;
        if (childrenCount <= 100) return 1;
        return 1;
    }

    function getContractorStrokeOpacity(childrenCount) {
        if (!childrenCount || childrenCount === 0) return 0.0;
        if (childrenCount <= 10) return 1.0;
        if (childrenCount <= 50) return 1.0;
        if (childrenCount <= 100) return 1.0;
        return 1.0;
    }

    function generateCompanyDetailsHtml(nodeData, childrenStatusMessage) {
        const name = nodeData.name || '이름 없음';
        const bizNo = nodeData.id || '번호 없음';
        const ceo = nodeData.ceo || 'N/A';
        const address = nodeData.address || 'N/A';
        const csoRegistNo = nodeData.cso_regist_no || 'N/A';
        // 제목 없이 업체명부터 바로 출력
        return `
            <h4>${name}</h4>
            <p><strong>대표자명 :</strong> ${ceo}</p>
            <p><strong>사업자등록번호 :</strong> ${bizNo}</p>
            <p><strong>주소 :</strong> ${address}</p>
            <p><strong>재위탁 통보 업체 :</strong> ${childrenStatusMessage}</p>
        `;
    }

    function generatePharmacyDetailsHtml(nodeData, childrenStatusMessage){
        const companyNameOnly = (nodeData.name || '이름 없음').replace('(제약사)','').trim();
        const bizNo = nodeData.id || '번호 없음';
        const ceo = nodeData.ceo || 'N/A';
        const address = nodeData.address || 'N/A';
        // 제목 없이 업체명부터 바로 출력
        return `
            <h4>${companyNameOnly}</h4>
            <p><strong>대표자명 :</strong> ${ceo}</p>
            <p><strong>사업자등록번호 :</strong> ${bizNo}</p>
            <p><strong>주소 :</strong> ${address}</p>
            <p><strong>법인 CSO 업체 :</strong> ${childrenStatusMessage}</p>
        `;
    }

    function updateGraph() {
        console.log("updateGraph 호출됨");

        const visibleNodes = [];
        const visibleLinks = [];
        const visitedInCurrentTraversal = new Set();

        function getVisibleChildren(parentNode) {
            console.log(`[getVisibleChildren 시작] 호출 대상 노드: ${parentNode.id} (${parentNode.name}), isExpanded: ${parentNode.isExpanded}, _children ID 개수: ${parentNode._children?.length}`);

            if (!parentNode.isExpanded || !parentNode._children || parentNode._children.length === 0) {
                return;
            }

            parentNode._children.forEach(childIdentifier => {
                const childId = childIdentifier.id || childIdentifier;
                const childNode = window.allNodes_source.find(n => n.id === childId);

                // 부모-자식 쌍 기준 방문 체크
                const visitKey = `${parentNode.id}-${childId}`;
                if (visitedInCurrentTraversal.has(visitKey)) {
                    return;
                }
                visitedInCurrentTraversal.add(visitKey);

                console.log(`[getVisibleChildren 루프] 부모: ${parentNode.id}, 자식 ID: ${childId}, 찾아진 childNode:`, childNode ? childNode.id : '못 찾음');

                if (childNode) {
                    childNode.depth = parentNode.depth + 1; // 깊이 설정

                    // 아직 visibleNodes 목록에 없다면 추가
                    if (!visibleNodes.find(vn => vn.id === childNode.id)) {
                        visibleNodes.push(childNode);
                    }

                    // 링크 추가 (중복 방지)
                    const linkExists = visibleLinks.some(l =>
                        (l.source.id || l.source) === parentNode.id &&
                        (l.target.id || l.target) === childNode.id
                    );
                    if (!linkExists) {
                        visibleLinks.push({ 
                            source: parentNode.id, 
                            target: childNode.id
                        });
                    }

                    // 자식 노드가 확장 상태이고 하위 노드가 더 있다면 재귀 호출
                    // (이때, childNode가 visitedInCurrentTraversal에 이미 있다면, 다음 getVisibleChildren 호출 초입에서 return으로 걸러짐)
                    if (childNode.isExpanded && childNode._children) {
                        getVisibleChildren(childNode); // 재귀
                    }
                } else {
                    console.warn(`[DEBUG] childNode를 allNodes_source에서 찾지 못함. childId: ${childId}. parentNode:`, parentNode);
                }
            });
        }

        const rootNode = window.allNodes_source.find(n => n.isPharmacy);
        if (rootNode) {
            if (!visibleNodes.find(vn => vn.id === rootNode.id)) {
                visibleNodes.push(rootNode);
            }
            if (rootNode.isExpanded && rootNode._children) {
                 rootNode._children.forEach(childId => {
                    const contractorNodeInAll = window.allNodes_source.find(n => n.id === childId);
                    if(contractorNodeInAll){
                        if (!visibleNodes.find(vn => vn.id === contractorNodeInAll.id)) {
                             visibleNodes.push(contractorNodeInAll);
                        }
                        const linkExists = visibleLinks.some(l => l.source === rootNode.id && l.target === contractorNodeInAll.id);
                        if (!linkExists) {
                            visibleLinks.push({ source: rootNode.id, target: contractorNodeInAll.id, isCircular: false });
                        }
                        getVisibleChildren(contractorNodeInAll);
                    }
                 });
            }
        }

        const currentNodes = [...new Map(visibleNodes.map(item => [item.id, item])).values()];
        const currentLinks = [...new Map(visibleLinks.map(item => [`${item.source.id || item.source}-${item.target.id || item.target}`, item])).values()];

        console.log("표시할 노드 (currentNodes):", currentNodes);
        console.log("표시할 링크 (currentLinks):", currentLinks);

        if (!mainViewG || !simulation) {
            console.error("Main View Group 또는 Simulation이 초기화되지 않았습니다.");
            return;
        }

        linkElementsSelection = mainViewG.select(".links")
            .selectAll("line")
            .data(currentLinks, d => `${d.source.id || d.source}-${d.target.id || d.target}`);

        linkElementsSelection.exit().remove();
        linkElementsSelection = linkElementsSelection.enter().append("line")
            .attr("stroke-width", 0.5)
            .attr("stroke", d => {
                const sid = d.source.id || d.source;
                const tid = d.target.id || d.target;
                if (window.selectedNodeId && (sid === window.selectedNodeId || tid === window.selectedNodeId)) {
                    return "rgb(30, 102, 161)";
                }
                return "#bbb";
            })
            .attr("marker-end", d => {
                const sid = d.source.id || d.source;
                const tid = d.target.id || d.target;
                if (window.selectedNodeId && (sid === window.selectedNodeId || tid === window.selectedNodeId)) {
                    return "url(#end-selected)";
                }
                return "url(#end)";
            })
            .attr("marker-start", d => {
                const sid = d.source.id || d.source;
                const tid = d.target.id || d.target;
                if (window.selectedNodeId && (sid === window.selectedNodeId || tid === window.selectedNodeId)) {
                    return "url(#start-selected)";
                }
                return "url(#start)";
            })
            .style("opacity", 0)
            .transition()
            .duration(500)
            .style("opacity", 1)
            .selection()
            .merge(linkElementsSelection);

        nodeGroupElementsSelection = mainViewG.select(".nodes")
            .selectAll(".node-group")
            .data(currentNodes, d => d.id);

        nodeGroupElementsSelection.exit().remove();

        const newGroups = nodeGroupElementsSelection.enter().append("g")
            .attr("class", d => `node-group ${d.isPharmacy ? 'pharmacy-node' : 'contractor-node'}`)
            .call(drag(simulation))
            .on("click", async function(event, d) {
                event.stopPropagation();
                if (d.isPharmacy) {
                    window.selectedNodeId = null;
                } else {
                    window.selectedNodeId = d.id;
                }
                console.log("노드 클릭:", JSON.parse(JSON.stringify(d)));
                console.log(`클릭된 노드 ID: ${d.id}, 이름: ${d.name}, 현재 isExpanded: ${d.isExpanded}, _children 상태:`, d._children === null ? "null (로드 필요)" : (d._children.length === 0 ? "빈 배열 (하위 없음)" : "데이터 있음"));

                if (d.isPharmacy) {
                    console.log("제약사 노드 클릭됨. isExpanded 토글 전:", d.isExpanded);
                    d.isExpanded = !d.isExpanded;
                    console.log("제약사 노드 isExpanded 토글 후:", d.isExpanded);
                    const childrenMessage = `${d.childrenCount || 0}개`;
                    companyDetailsContainer.innerHTML = generatePharmacyDetailsHtml(d, childrenMessage);
                    updateGraph();
                    return;
                }

                if (d._children === null) {
                    console.log(`노드 ${d.id}: _children is null. 하위 업체 정보 로딩 시도.`);
                    const loggedInPharmacyBizNo = window.pharmacyInfo_source?.biz_no;
                    if (!loggedInPharmacyBizNo) {
                        console.error("오류: 로그인한 제약사 정보를 찾을 수 없습니다.");
                        companyDetailsContainer.innerHTML = `<h4>${d.name || '이름 없음'}</h4><p><strong>사업자등록번호 :</strong> ${d.id || '번호 없음'}</p><p style="color:red;">오류: 로그인한 제약사 정보를 찾을 수 없습니다.</p>`;
                        return;
                    }
                    
                    console.log('하위 업체 RPC 호출 파라미터:', {
                        selected_pharmacist_biz_no: loggedInPharmacyBizNo,
                        selected_parent_biz_no: d.id
                    });

                    const { data: subData, error: subError } = await supabase.rpc('get_reported_sub_contractors', {
                        selected_pharmacist_biz_no: loggedInPharmacyBizNo,
                        selected_parent_biz_no: d.id
                    });

                    console.log('하위 업체 RPC 결과:', subData, subError);

                    companyDetailsContainer.innerHTML = generateCompanyDetailsHtml(d, `하위 업체 정보 로딩 중...`);
                    
                    try {
                        const receivedChildrenData = subData || [];
                        const childNodeIds = [];

                        receivedChildrenData.forEach(sd => {
                            let existingNode = window.allNodes_source.find(n => n.id === sd.biz_no);

                            if (!existingNode) {
                                existingNode = {
                                    id: sd.biz_no,
                                    name: sd.company_name,
                                    displayName: formatCompanyName(sd.company_name),
                                    ceo: sd.ceo_name,
                                    address: sd.address,
                                    cso_regist_no: sd.cso_regist_no,
                                    isPharmacy: false,
                                    isExpanded: false,
                                    _children: null,
                                    depth: d.depth + 1,
                                    childrenCount: sd.children_count || 0,
                                    x: d.x + (Math.random() - 0.5) * 30,
                                    y: d.y + (Math.random() - 0.5) * 30,
                                };
                                window.allNodes_source.push(existingNode);
                                console.log(`새로운 하위 노드 ${existingNode.id}를 allNodes_source에 추가함.`);
                            } else {
                                existingNode.childrenCount = sd.children_count || 0;
                                if (existingNode._children === null) {
                                    existingNode._children = [];
                                }
                            }
                            childNodeIds.push(existingNode.id);
                        });

                        // [여기 추가] d._children이 null이면 빈 배열로 초기화
                        if (d._children === null) {
                            d._children = [];
                        }
                        d._children = childNodeIds;
                        d.childrenCount = d._children.length;
                        d.isExpanded = true;
                        console.log(`[클릭 핸들러] 노드 ${d.id} 확장 시도: isExpanded=${d.isExpanded}, _children ID 개수=${d._children?.length}`, JSON.parse(JSON.stringify(d)));
                        companyDetailsContainer.innerHTML = generateCompanyDetailsHtml(d, `${d.childrenCount || 0}개`);

                    } catch (rpcError) {
                        console.error(`RPC 호출 중 예외 발생 (노드 ID: ${d.id}):`, rpcError);
                        companyDetailsContainer.innerHTML = generateCompanyDetailsHtml(d, '<span style="color:red;">정보 로드 중 오류 발생.</span>');
                        d._children = [];
                        d.childrenCount = 0;
                        d.isExpanded = false;
                        updateGraph();
                        return;
                    }
                } else {
                    console.log(`노드 ${d.id}: _children 존재. isExpanded 상태 토글.`);
                    d.isExpanded = !d.isExpanded;
                    console.log(`[클릭 핸들러] 노드 ${d.id} 토글: isExpanded=${d.isExpanded}, _children ID 개수=${d._children?.length}`, JSON.parse(JSON.stringify(d)));
                    companyDetailsContainer.innerHTML = generateCompanyDetailsHtml(d, `${d.childrenCount || 0}개`);
                }
                updateGraph();
            });

        // 새로운 노드의 circle에 트랜지션 적용
        newGroups.append("circle")
            .attr("r", 0) // 초기 반지름 0으로 시작
            .style("opacity", 0); // 초기 투명도 0으로 시작

        // 새로운 노드의 text에 트랜지션 적용
        newGroups.append("text")
            .attr("dy", ".35em")
            .attr("text-anchor", "middle")
            .style("font-size", d => {
                if (window.selectedNodeId && d.id === window.selectedNodeId) return "14px";
                return "10px";
            })
            .style("opacity", 0); // 초기 투명도 0으로 시작

        nodeGroupElementsSelection = newGroups.merge(nodeGroupElementsSelection);
        
        // 기존 및 새로운 노드의 circle 스타일 및 트랜지션
        nodeGroupElementsSelection.select("circle")
            .transition()
            .duration(500)
            .attr("r", d => d.isPharmacy ? PHARMACY_NODE_FIXED_RADIUS : getNodeRadius(d.childrenCount))
            .style("opacity", 1)
            .style("fill", d => {
                if (d.isPharmacy) return "crimson";
                if (window.selectedNodeId && d.id === window.selectedNodeId) return "rgb(255, 255, 128)";
                return getContractorFillColor(d.childrenCount);
            })
            .style("fill-opacity", d => d.isPharmacy ? 1 : getContractorFillOpacity(d.childrenCount))
            .style("stroke", d => {
                if (d.isPharmacy) return "darkred";
                if (window.selectedNodeId && d.id === window.selectedNodeId) return "crimson";
                return getContractorStrokeColor(d.childrenCount);
            })
            .style("stroke-width", d => {
                if (d.isPharmacy) return 2;
                if (window.selectedNodeId && d.id === window.selectedNodeId) return 3;
                return getContractorStrokeWidth(d.childrenCount);
            })
            .style("stroke-opacity", d => d.isPharmacy ? 1 : getContractorStrokeOpacity(d.childrenCount));

        // 기존 및 새로운 노드의 text 스타일 및 트랜지션
        nodeGroupElementsSelection.select("text")
            .style("font-size", d => {
                if (window.selectedNodeId && d.id === window.selectedNodeId) return "14px";
                return "12px";
            })
            .style("fill", d => {
                if (d.isPharmacy) return "rgb(255,255,255)";
                if (window.selectedNodeId && d.id === window.selectedNodeId) return "crimson";
                return "rgb(0,0,0)";
            })
            .style("font-weight", d => {
                if (d.isPharmacy) return "normal";
                if (window.selectedNodeId && d.id === window.selectedNodeId) return "bold";
                return "normal";
            })
            .attr("dy", d => { 
                if (d.isPharmacy) {
                    return ".35em"; // 제약사 텍스트 원 중앙
                } else {
                    const contractorNodeRadius = getNodeRadius(d.childrenCount);
                    const dyValue = contractorNodeRadius + 12; 
                    return dyValue; // 위탁업체 텍스트 원 아래
                }
            })
            .each(function(d) {
                const el = d3.select(this);
                el.selectAll("tspan").remove();
                el.text(null);

                const name = d.displayName; // formatCompanyName에서 가공된 값
                if (!name) return;

                // 줄바꿈(\n) 기준으로 분리
                const lines = name.split('\n');
                lines.forEach((line, i) => {
                    el.append("tspan")
                        .text(line)
                        .attr("x", 0)
                        .attr("dy", i === 0 ? "0.35em" : "1.1em");
                });
            })
            .transition() // 텍스트 투명도 트랜지션 시작
            .duration(500) // 애니메이션 지속 시간 (circle과 동일하게 또는 다르게 설정 가능)
            .style("opacity", 1); // 최종 투명도 1

        simulation.nodes(currentNodes);
        simulation.force("link").links(currentLinks);
        simulation.alpha(0.3).restart(); 
        simulation.alphaDecay(0.05);

        // 링크(화살표) 스타일 지정
        linkElementsSelection
            .attr("marker-end", d => {
                const sid = d.source.id || d.source;
                const tid = d.target.id || d.target;
                if (window.selectedNodeId && (sid === window.selectedNodeId || tid === window.selectedNodeId)) {
                    return "url(#end-selected)";
                }
                return "url(#end)";
            })
            .attr("marker-start", d => {
                const sid = d.source.id || d.source;
                const tid = d.target.id || d.target;
                if (window.selectedNodeId && (sid === window.selectedNodeId || tid === window.selectedNodeId)) {
                    return "url(#start-selected)";
                }
                return "url(#start)";
            })
            .style("stroke", d => {
                const sid = d.source.id || d.source;
                const tid = d.target.id || d.target;
                if (window.selectedNodeId && (sid === window.selectedNodeId || tid === window.selectedNodeId)) {
                    return "rgb(30, 102, 161)";
                }
                return "#bbb";
            })
            .style("stroke-width", d => {
                const sid = d.source.id || d.source;
                const tid = d.target.id || d.target;
                if (window.selectedNodeId && (sid === window.selectedNodeId || tid === window.selectedNodeId)) {
                    return 0.5;
                }
                return 0.5;
            });
    }

    async function initializeGraph(initialContractorData, pharmacyData) {
        console.log("D3 시각화 초기화 시작. 제약사 정보:", pharmacyData);
        visualizationContainer.innerHTML = '';
        d3.select("#visualization-container svg").remove(); 

        const containerRect = visualizationContainer.getBoundingClientRect();
        const width = containerRect.width > 0 ? containerRect.width : 800;
        const height = containerRect.height > 0 ? containerRect.height : 600; 

        svgInstance = d3.select("#visualization-container").append("svg") 
            .attr("width", width).attr("height", height)
            .style("display", "block"); 
        
        mainViewG = svgInstance.append("g").attr("class", "main-view-group");

        window.contractorNodesData_source = initialContractorData; 
        window.allNodes_source = []; 

        let pharmacyNode = null;
        if (pharmacyData && pharmacyData.biz_no) {
            pharmacyNode = {
                id: pharmacyData.biz_no, 
                name: `${pharmacyData.company_name || (pharmacyData.userEmail ? pharmacyData.userEmail.split('@')[0] : '제약사')} (제약사)`,
                displayName: formatCompanyName(pharmacyData.company_name || (pharmacyData.userEmail ? pharmacyData.userEmail.split('@')[0] : '제약사')),
                ceo: pharmacyData.ceo || null, 
                address: pharmacyData.address || null, 
                isPharmacy: true, 
                childrenCount: initialContractorData.length, 
                isExpanded: true, 
                _children: initialContractorData.map(c => c.biz_no), 
                depth: 0,
                fx: width / 2, 
                fy: height / 2
            };
            console.log('[initializeGraph] Pharmacy Node - ID:', pharmacyNode.id, 'childrenCount:', pharmacyNode.childrenCount, 'Initial Data Length:', initialContractorData.length); // 로그 추가
            window.allNodes_source.push(pharmacyNode);
        }

        initialContractorData.forEach(node => {
            const contractorFullNode = {
                id: node.biz_no, name: node.company_name, displayName: formatCompanyName(node.company_name),
                ceo: node.ceo_name, address: node.address, cso_regist_no: node.cso_regist_no,
                isPharmacy: false, 
                isExpanded: false, 
                _children: null,    
                depth: 1, 
                childrenCount: node.children_count || 0 
            };
            console.log(`[initializeGraph] Contractor Node - ID: ${contractorFullNode.id}, Name: ${contractorFullNode.name}, children_count from data: ${node.children_count}, Assigned childrenCount: ${contractorFullNode.childrenCount}`); // 로그 추가
            if (!window.allNodes_source.find(n => n.id === contractorFullNode.id)) {
                window.allNodes_source.push(contractorFullNode);
            }
        });
        
        console.log("초기화 후 모든 노드 (allNodes_source):", JSON.parse(JSON.stringify(window.allNodes_source)));
        
        mainViewG.append("g").attr("class", "links");
        mainViewG.append("g").attr("class", "nodes");

        const defs = svgInstance.append("defs");
        // 일반 선용 (end, start)
        defs.append("marker")
            .attr("id", "end")
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 8)
            .attr("refY", 0)
            .attr("markerWidth", 8)
            .attr("markerHeight", 12)
            .attr("orient", "auto")
            .append("path")
            .attr("d", "M0,-5L10,0L0,5")
            .attr("fill", "#bbb");

        defs.append("marker")
            .attr("id", "start")
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 2)
            .attr("refY", 0)
            .attr("markerWidth", 8)
            .attr("markerHeight", 12)
            .attr("orient", "auto")
            .append("path")
            .attr("d", "M10,-5L0,0L10,5")
            .attr("fill", "#bbb");

            // 선택된 선용 (end-selected, start-selected)
        defs.append("marker")
            .attr("id", "end-selected")
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 8)
            .attr("refY", 0)
            .attr("markerWidth", 12)
            .attr("markerHeight", 18)
            .attr("orient", "auto")
            .append("path")
            .attr("d", "M0,-5L10,0L0,5")
            .attr("fill", "rgb(30, 102, 161)");

        defs.append("marker")
            .attr("id", "start-selected")
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 2)
            .attr("refY", 0)
            .attr("markerWidth", 12)
            .attr("markerHeight", 18)
            .attr("orient", "auto")
            .append("path")
            .attr("d", "M10,-5L0,0L10,5")
            .attr("fill", "rgb(30, 102, 161)");

        simulation = d3.forceSimulation() 
            .force("link", d3.forceLink().id(d => d.id).distance(d => d.target.depth === 1 ? 120 : 80).strength(0.6)) 
            .force("charge", d3.forceManyBody().strength(-350)) 
            .force("x", d3.forceX(width / 2).strength(0.03)) 
            .force("y", d3.forceY(height / 2).strength(0.03)) 
            .force("collide", d3.forceCollide().radius(d => {
                const radius = d.isPharmacy ? PHARMACY_NODE_FIXED_RADIUS : getNodeRadius(d.childrenCount);
                return radius + 10; // 계산된 반지름에 약간의 여백 추가
            }).iterations(2)); 
        
        simulation.alphaDecay(0.05);

        const zoomBehavior = d3.zoom()
            .scaleExtent([0.1, 8])
            .filter(event => {
                if (event.type === 'wheel') return event.ctrlKey;
                return !event.button; 
            })
            .wheelDelta(event => -event.deltaY * 0.0020) 
            .on('zoom', (event) => {
                mainViewG.attr('transform', event.transform);
            });

        svgInstance.call(zoomBehavior);
        svgInstance.on("mousedown.zoom", (event) => { 
            if (!event.ctrlKey && event.button === 0) { 
                svgInstance.style("cursor", "grabbing");
            }
        })
        .on("mouseup.zoom", () => {
            svgInstance.style("cursor", "default");
        });
        
        simulation.on("tick", () => { 
            if (linkElementsSelection) {
                linkElementsSelection
                    .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
                    .each(function(d_link) {
                        const targetNode = d_link.target;
                        const sourceNode = d_link.source;
                        // 이 targetRadius 계산은 이전에 성공적으로 수정된 것으로 보입니다.
                        const targetRadius = getNodeRadius(targetNode.childrenCount); 
                        const angle = Math.atan2(targetNode.y - sourceNode.y, targetNode.x - sourceNode.x);
                        const targetX = targetNode.x - Math.cos(angle) * (targetRadius + 6);
                        const targetY = targetNode.y - Math.sin(angle) * (targetRadius + 6);
                        d3.select(this)
                            .attr("x2", targetX)
                            .attr("y2", targetY);
                    });
            }
            if (nodeGroupElementsSelection) {
                nodeGroupElementsSelection
                    .attr("transform", d => `translate(${d.x}, ${d.y})`);
            }
        });
        updateGraph(); 
        // [추가] 최초 로딩 시 제약사 노드를 선택된 상태로 설정
        if (pharmacyNode) {
            window.selectedNodeId = pharmacyNode.id;
            companyDetailsContainer.innerHTML = generatePharmacyDetailsHtml(pharmacyNode, `${pharmacyNode.childrenCount || 0}개`);
            updateGraph();
        }

        window.parentMap = {};
        const { data: rels, error: relError } = await supabase
            .from('subcontract_relation')
            .select('parent_biz_no, child_biz_no')
            .eq('pharmacist_biz_no', pharmacyData.biz_no);
        if (relError) {
            console.error('subcontract_relation 조회 오류:', relError.message);
            return;
        }
        if (rels && rels.length > 0) {
            rels.forEach(r => {
                if (r.child_biz_no && r.parent_biz_no) {
                    window.parentMap[r.child_biz_no.trim()] = r.parent_biz_no.trim();
                }
            });
        }
    }

    function drag(simulationInstance) { 
        function dragstarted(event, d) {
            if (!event.active) simulationInstance.alphaTarget(0.1).restart(); 
            d.fx = d.x; d.fy = d.y;
        }
        function dragged(event, d) { 
            d.fx = event.x; d.fy = event.y; 
        }
        function dragended(event, d) {
            if (!event.active) simulationInstance.alphaTarget(0);
        }
        return d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended);
    }

    async function initializeApp() {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError || !session) {
            console.log('세션이 없거나 오류 발생, login.html로 리디렉션합니다.', sessionError || '');
            window.location.href = 'login.html';
            return; // 리디렉션 후 추가 실행 방지
        }

        // 세션이 있는 경우, 사용자 정보 표시 및 데이터 로드
        console.log('활성 세션 존재 (main.js), 사용자:', session.user);
        const pharmacyDbInfo = await fetchUserCompanyBizNo(session.user.id);
        displayUserInfo(session.user, pharmacyDbInfo); 
        if (pharmacyDbInfo && pharmacyDbInfo.biz_no) {
            await loadPrimaryContractors({ 
                userEmail: session.user.email, 
                biz_no: pharmacyDbInfo.biz_no,
                company_name: pharmacyDbInfo.company_name,
                ceo: pharmacyDbInfo.ceo, // 추가: CEO 정보 전달
                address: pharmacyDbInfo.address // 추가: 주소 정보 전달
            });
        } else {
             visualizationContainer.innerHTML = '<p style="color:red;">사용자의 회사 정보를 조회할 수 없어 데이터를 로드할 수 없습니다. (users 테이블 확인 필요)</p>';
             console.error("초기화: 사용자의 회사 Biz No를 users 테이블에서 찾을 수 없습니다.");
             // 이 경우에도 로그아웃 버튼은 표시되어야 사용자가 로그아웃하고 다시 시도할 수 있음
        }

        // onAuthStateChange 리스너는 계속 유지하여, 혹시 모를 상태 변경에 대응
        // (예: 토큰 만료 후 자동 로그아웃 처리 등 Supabase 내부 로직에 의해 세션이 변경될 경우)
        supabase.auth.onAuthStateChange(async (_event, currentSession) => {
            console.log('Auth 상태 변경 감지 (main.js):', _event, currentSession);
            if (!currentSession) {
                // 세션이 사라지면 로그인 페이지로 강제 이동
                console.log('세션이 사라짐 (main.js), login.html로 리디렉션합니다.');
                window.location.href = 'login.html';
            } else if (currentSession.user?.id !== session.user.id || _event === 'USER_UPDATED') {
                // 다른 사용자로 변경되었거나 사용자 정보가 업데이트된 경우 앱 재초기화 또는 UI 갱신
                // 간단하게는 페이지를 새로고침하거나, initializeApp을 다시 호출하는 방식도 고려 가능
                // 여기서는 pharmacyDbInfo가 변경되었을 수 있으므로, 사용자 정보를 다시 로드하고 UI를 갱신합니다.
                console.log("사용자 정보 변경 또는 업데이트 감지, UI 갱신 시도");
                const updatedPharmacyDbInfo = await fetchUserCompanyBizNo(currentSession.user.id);
                displayUserInfo(currentSession.user, updatedPharmacyDbInfo); 
                // 데이터도 다시 로드할지 여부는 정책에 따라 결정 (여기서는 UI만 업데이트)
                 if (updatedPharmacyDbInfo && updatedPharmacyDbInfo.biz_no) { // 데이터도 다시 로드하는 로직 추가
                    await loadPrimaryContractors({ 
                        userEmail: currentSession.user.email, 
                        biz_no: updatedPharmacyDbInfo.biz_no,
                        company_name: updatedPharmacyDbInfo.company_name,
                        ceo: updatedPharmacyDbInfo.ceo,
                        address: updatedPharmacyDbInfo.address
                    });
                }
            }
        });
    }

    // --- 검색 기능 구현 ---
    const searchInput = document.getElementById('company-search-input');
    const searchBtn = document.getElementById('company-search-btn');
    const searchForm = document.getElementById('company-search-form');
    const suggestionsList = document.getElementById('company-search-suggestions');
    let searchSelectedNodeId = null;

    // --- 검색/자동완성용 데이터: 로그인 제약사 기준 subcontract_relation + companies 조인 ---
    window.searchCompanyList = [];
    async function loadSearchCompanyList() {
        if (!window.pharmacyInfo_source || !window.pharmacyInfo_source.biz_no) return;
        try {
            // 1. subcontract_relation에서 pharmacist_biz_no가 로그인 제약사와 일치하는 parent/child_biz_no 모두 수집
            const { data: rels, error: relError } = await supabase
                .from('subcontract_relation')
                .select('parent_biz_no, child_biz_no')
                .eq('pharmacist_biz_no', window.pharmacyInfo_source.biz_no);
            if (relError) {
                console.error('subcontract_relation 조회 오류:', relError.message);
                return;
            }
            const bizNoSet = new Set();
            (rels || []).forEach(r => {
                if (r.parent_biz_no) bizNoSet.add(r.parent_biz_no.trim());
                if (r.child_biz_no) bizNoSet.add(r.child_biz_no.trim());
            });
            const bizNoArr = Array.from(bizNoSet);
            console.log('subcontract_relation row count:', rels.length);
            console.log('unique biz_no count:', bizNoArr.length);
            // Chunking: 1000개씩 나눠서 요청
            const chunkSize = 1000;
            let allCompanies = [];
            for (let i = 0; i < bizNoArr.length; i += chunkSize) {
                const chunk = bizNoArr.slice(i, i + chunkSize);
                const { data: companies, error: compError } = await supabase
                    .from('companies')
                    .select('biz_no, company_name, ceo_name, address, cso_regist_no')
                    .in('biz_no', chunk);
                if (compError) {
                    console.error('companies 조회 오류:', compError.message);
                    continue;
                }
                if (companies && companies.length > 0) {
                    allCompanies = allCompanies.concat(companies);
                }
            }
            window.searchCompanyList = allCompanies;
            console.log('최종 업체 수:', window.searchCompanyList.length);
        } catch (e) {
            console.error('검색용 업체 정보 로딩 예외:', e);
        }
    }
    // 앱 초기화 후 검색용 데이터 로딩
    setTimeout(loadSearchCompanyList, 2000);

    // --- 자동완성 후보는 searchCompanyList에서만 ---
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

    // --- 부모를 따라가며 자동 확장 (재귀) ---
    async function expandToNode(targetId) {
        let node = window.allNodes_source.find(n => n.id === targetId);
        if (node) return node;

        // 부모가 있으면 부모부터 확장
        const parentId = window.parentMap[targetId];
        if (parentId) {
            const parentNode = await expandToNode(parentId);
            if (parentNode) {
                // 부모 노드 확장
                if (!parentNode.isExpanded) {
                    parentNode.isExpanded = true;
                    await expandAndSelectNodeById(parentNode.id);
                }
                // expandAndSelectNodeById가 자식 노드를 추가했을 것
                return window.allNodes_source.find(n => n.id === targetId);
            }
        }
        return null;
    }

    // --- 검색 후 해당 노드 및 하위 노드 자동 확장 ---
    async function expandAndSelectNodeById(targetId) {
        let node = window.allNodes_source.find(n => n.id === targetId);
        if (!node) {
            // 부모부터 재귀적으로 펼침
            node = await expandToNode(targetId);
        }
        if (node) {
            window.selectedNodeId = node.id;
            if (node.isPharmacy) {
                companyDetailsContainer.innerHTML = generatePharmacyDetailsHtml(node, `${node.childrenCount || 0}개`);
            } else {
                companyDetailsContainer.innerHTML = generateCompanyDetailsHtml(node, `${node.childrenCount || 0}개`);
            }
            // 하위 업체가 있으면 자동으로 펼침
            if (node.childrenCount > 0 && node._children === null) {
                // 하위 업체 정보 로드 (기존 클릭 핸들러와 동일하게)
                const loggedInPharmacyBizNo = window.pharmacyInfo_source?.biz_no;
                const { data: subData, error: subError } = await supabase.rpc('get_reported_sub_contractors', {
                    selected_pharmacist_biz_no: loggedInPharmacyBizNo,
                    selected_parent_biz_no: node.id
                });
                if (!subError) {
                    const receivedChildrenData = subData || [];
                    const childNodeIds = [];
                    receivedChildrenData.forEach(sd => {
                        let existingNode = window.allNodes_source.find(n => n.id === sd.biz_no);
                        if (!existingNode) {
                            existingNode = {
                                id: sd.biz_no,
                                name: sd.company_name,
                                displayName: formatCompanyName(sd.company_name),
                                ceo: sd.ceo_name,
                                address: sd.address,
                                cso_regist_no: sd.cso_regist_no,
                                isPharmacy: false,
                                isExpanded: false,
                                _children: null,
                                depth: node.depth + 1,
                                childrenCount: sd.children_count || 0,
                                x: node.x + (Math.random() - 0.5) * 30,
                                y: node.y + (Math.random() - 0.5) * 30,
                            };
                            window.allNodes_source.push(existingNode);
                        } else {
                            existingNode.childrenCount = sd.children_count || 0;
                            if (existingNode._children === null) {
                                existingNode._children = [];
                            }
                        }
                        childNodeIds.push(existingNode.id);
                    });
                    if (node._children === null) node._children = [];
                    node._children = childNodeIds;
                    node.childrenCount = node._children.length;
                    node.isExpanded = true;
                }
            } else if (node.childrenCount > 0) {
                node.isExpanded = true;
            }
            updateGraph();
        } else {
            alert('해당 업체는 현재 그래프에서 찾을 수 없습니다. (부모 노드부터 수동으로 펼쳐주세요)');
        }
    }

    // 자동완성 리스트 렌더링 (후보 없으면 안내 메시지)
    function renderSuggestions(keyword) {
        const suggestions = getSearchSuggestions(keyword);
        suggestionsList.innerHTML = '';
        if (keyword.length < 2 || !window.searchCompanyList || window.searchCompanyList.length === 0) {
            suggestionsList.style.display = 'none';
            if (keyword.length >= 2 && (!window.searchCompanyList || window.searchCompanyList.length === 0)) {
                const li = document.createElement('li');
                li.textContent = '검색 데이터가 준비 중입니다.';
                li.style.color = '#888';
                li.style.padding = '6px 10px';
                suggestionsList.appendChild(li);
                suggestionsList.style.display = 'block';
            }
            return;
        }
        if (suggestions.length === 0) {
            const li = document.createElement('li');
            li.textContent = '일치하는 업체가 없습니다.';
            li.style.color = '#888';
            li.style.padding = '6px 10px';
            suggestionsList.appendChild(li);
            suggestionsList.style.display = 'block';
            return;
        }
        suggestions.slice(0, 20).forEach(node => {
            const li = document.createElement('li');
            li.style.padding = '6px 10px';
            li.style.cursor = 'pointer';
            li.style.borderBottom = '1px solid #eee';
            li.textContent = `${node.company_name} / ${node.biz_no}${node.ceo_name ? ' / ' + node.ceo_name : ''}`;
            li.addEventListener('mousedown', e => {
                e.preventDefault();
                searchInput.value = node.company_name;
                searchSelectedNodeId = node.biz_no;
                suggestionsList.style.display = 'none';
            });
            suggestionsList.appendChild(li);
        });
        suggestionsList.style.display = 'block';
    }

    searchInput.addEventListener('input', e => {
        searchSelectedNodeId = null;
        console.log('자동완성 후보:', getSearchSuggestions(e.target.value));
        renderSuggestions(e.target.value);
    });
    searchInput.addEventListener('focus', e => {
        renderSuggestions(e.target.value);
    });

    searchForm.addEventListener('submit', async (e) => {
        e.preventDefault(); // 새로고침 방지

        if (!searchSelectedNodeId) {
            alert('업체를 선택해 주세요.');
            return;
        }
        await expandAndSelectNodeById(searchSelectedNodeId);
        suggestionsList.style.display = 'none';
    });

    await initializeApp();
});
