let parsedExcelData = { 10: [], 20: [], 40: [] };
let currentPage = 1;
const ROWS_PER_PAGE = 50;
let flattenedData = [];

document.addEventListener('DOMContentLoaded', () => {
    // Inject Modal HTML
    const modalHTML = `
    <div id="excelPreviewModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:9999; justify-content:center; align-items:center;">
        <div style="background:#2f3542; width:95%; height:90%; border-radius:10px; display:flex; flex-direction:column; padding:20px; box-sizing:border-box;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <h2 style="margin:0; color:#00d2d3;">Preview & Edit Đề</h2>
                <button class="btn-secondary" onclick="document.getElementById('excelPreviewModal').style.display='none'">ĐÓNG</button>
            </div>
            
            <div style="margin-bottom: 10px; display:flex; align-items:center; gap: 10px; flex-wrap:wrap;">
                <button class="btn-green" onclick="saveParsedData('draft')">💾 LƯU BẢN NHÁP</button>
                <div style="width:2px; height:30px; background:#576574; margin:0 10px;"></div>
                <select id="previewSaveSlot" style="padding:8px; border-radius:4px;">
                    <option value="1">Đề 1</option><option value="2">Đề 2</option><option value="3">Đề 3</option>
                    <option value="4">Đề 4</option><option value="5">Đề 5</option><option value="6">Đề 6</option>
                </select>
                <input type="text" id="previewSaveName" placeholder="Tên bộ đề (VD: Chung kết)" style="padding:8px; border-radius:4px;">
                <button class="btn-orange" onclick="saveParsedData('official')">💾 LƯU CHÍNH THỨC</button>
            </div>
            
            <div style="flex:1; overflow:auto; background:#1e272e; border:1px solid #576574;">
                <table style="width:100%; border-collapse:collapse; color:#fff;" id="previewTable">
                    <thead>
                        <tr style="background:#576574; text-align:left;">
                            <th style="padding:10px; width:50px; text-align:center;">
                                <input type="checkbox" id="chkAll" onchange="toggleAllRows(this)">
                            </th>
                            <th style="padding:10px; width:100px;">Phần</th>
                            <th style="padding:10px; width:60px;">STT</th>
                            <th style="padding:10px;">Câu Hỏi</th>
                            <th style="padding:10px;">Đáp Án</th>
                            <th style="padding:10px;">Link Video</th>
                            <th style="padding:10px; width:60px;">Xóa</th>
                        </tr>
                    </thead>
                    <tbody id="previewTbody"></tbody>
                </table>
            </div>
            
            <div style="margin-top:15px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <button class="btn-orange" onclick="deleteSelectedRows()">Xóa Dòng Đã Chọn</button>
                </div>
                <div id="paginationControls" style="color:#fff; display:flex; gap:10px; align-items:center;">
                </div>
            </div>
        </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    overrideAdminExcelLogic();
});

function overrideAdminExcelLogic() {
    window.loadExcel = function() {
        const file = document.getElementById('excelFile').files[0];
        if (!file) { alert(typeof t === 'function' ? t("adm_err_excel", window.currentGlobalLang) : "Chưa chọn file!"); return; }
        if (file.size > 10 * 1024 * 1024) {
            alert("File tải lên quá lớn! Giới hạn dung lượng là 10MB.");
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

                parseExcelJson(json);
            } catch (err) {
                alert("Lỗi Excel: " + err.message);
            }
        };
        reader.readAsArrayBuffer(file);
    };

    window.loadSlots = function() {
        fetch('/api/questions', { headers: { 'x-admin-pin': sessionStorage.getItem('adminAuth') || '' } })
        .then(r => r.json())
        .then(sets => {
            const grid = document.getElementById('slotGrid');
            if(!grid) return;
            grid.innerHTML = '';
            sets.forEach(s => {
                let displayName = s.name;
                let i18nAttr = '';
                if (/^(Đề|Set)\s\d$/.test(displayName)) {
                    i18nAttr = `data-i18n="adm_bank_slot_${s.id}"`;
                    var language = document.getElementById('settingLanguage') ? document.getElementById('settingLanguage').value : 'vi';
                    displayName = (typeof t === 'function') ? t('adm_save_name_prefix', language) + s.id : displayName;
                }
                
                let tag = s.isDraft ? `<span style="background:#e1b12c; color:#000; padding:2px 6px; border-radius:4px; font-size:10px; margin-left:5px; font-weight:bold;">NHÁP</span>` : '';
                
                grid.innerHTML += `
                    <div class="slot-card ${s.hasData ? 'has-data' : ''}" style="position:relative; padding-top:25px;">
                        ${s.hasData ? `<button class="btn-orange" style="position:absolute; top:5px; right:5px; padding:2px 8px; font-size:11px;" onclick="deleteSet('${s.id}')">XÓA</button>` : ''}
                        <h4 ${i18nAttr} style="margin-top:0;">${displayName} ${tag}</h4>
                        <small>${s.hasData ? (typeof t === 'function' ? t('adm_slot_txt', window.currentGlobalLang) : 'Đề').replace('{10}', s.count10).replace('{20}', s.count20).replace('{40}', s.count40) : (typeof t === 'function' ? t('adm_slot_empty', window.currentGlobalLang) : 'Trống')}</small><br>
                        <button class="btn-green" style="margin-top:8px; padding: 5px; font-size: 12px; width:100%; ${s.hasData ? '' : 'opacity:0.3; pointer-events:none;'}" 
                                onclick="loadFromSlot('${s.id}')">${typeof t === 'function' ? t("adm_slot_btn", window.currentGlobalLang) : 'Tải'}</button>
                    </div>
                `;
            });
        });
    };

    window.deleteSet = function(setId) {
        if (!confirm("Bạn có chắc chắn muốn xóa bộ đề này? (Không thể hoàn tác)")) return;
        fetch(`/api/questions/${setId}`, { headers: { 'x-admin-pin': sessionStorage.getItem('adminAuth') || '' },
            method: 'DELETE',
            headers: { 'X-Admin-Pin': sessionStorage.getItem('adminAuth') }
        }).then(r => r.json()).then(d => {
            loadSlots();
        });
    };
}

function parseExcelJson(json) {
    parsedExcelData = { 10: [], 20: [], 40: [] };
    
    let headerRowIdx = -1;
    for (let i = 0; i < json.length; i++) {
        let rowStr = json[i].map(x => String(x).toLowerCase().trim()).join(" ");
        if (rowStr.includes("stt") && rowStr.includes("câu hỏi") && rowStr.includes("đáp án")) {
            headerRowIdx = i;
            break;
        }
    }
    
    if (headerRowIdx === -1) {
        alert("Không tìm thấy dòng tiêu đề hợp lệ (cần có STT, CÂU HỎI, ĐÁP ÁN & GIẢI THÍCH, LINK VIDEO).");
        return;
    }
    
    let blankCount = 0;
    
    let offsets = { 10: 1, 20: 5, 40: 9 };
    
    for (let i = headerRowIdx + 1; i < json.length; i++) {
        let row = json[i] || [];
        if (row.length === 0 || row.join("").trim() === "") {
            blankCount++;
            if (blankCount >= 3) break;
            continue;
        }
        blankCount = 0; 
        
        for (const pts of [10, 20, 40]) {
            let base = offsets[pts];
            let stt = String(row[base] || "").trim();
            let q = String(row[base+1] || "").trim();
            let a = String(row[base+2] || "").trim();
            let vid = String(row[base+3] || "").trim();
            
            if (q || a) {
                let isValid = true;
                if (!q) isValid = false;
                
                parsedExcelData[pts].push({
                    id: Math.random().toString(36).substr(2,9),
                    stt: stt || parsedExcelData[pts].length + 1,
                    q: q.replace(/\r\n/g, '\n'),
                    a: a.replace(/\r\n/g, '\n'),
                    vid: vid,
                    isValid: isValid
                });
            }
        }
    }
    
    checkConflictsBeforePreview();
}

function checkConflictsBeforePreview() {
    fetch('/api/questions', { headers: { 'x-admin-pin': sessionStorage.getItem('adminAuth') || '' } })
    .then(r => r.json())
    .then(sets => {
        let fetchPromises = sets.filter(s => s.hasData).map(s => 
            fetch(`/api/questions/${s.id}`, { headers: { 'x-admin-pin': sessionStorage.getItem('adminAuth') || '' } }).then(r => r.json()).then(data => { return {id: s.id, name: s.name, data: data.questions}; })
        );
        Promise.all(fetchPromises).then(results => {
            let conflictName = null;
            let currentStr = JSON.stringify(cleanParsedData(parsedExcelData));
            
            for (let res of results) {
                if (JSON.stringify(res.data) === currentStr) {
                    conflictName = res.name;
                    break;
                }
            }
            
            if (conflictName) {
                alert(`CẢNH BÁO: Bộ đề này TRÙNG LẶP HOÀN TOÀN với bộ đề: ${conflictName}!`);
            }
            
            openPreviewModal();
        });
    });
}

function cleanParsedData(data) {
    let clone = { 10: [], 20: [], 40: [] };
    for (let pts of [10,20,40]) {
        for (let item of data[pts]) {
            clone[pts].push({
                stt: item.stt,
                q: item.q,
                a: item.a,
                vid: item.vid
            });
        }
    }
    return clone;
}

function openPreviewModal() {
    currentPage = 1;
    updateFlattenedData();
    renderPreviewTable();
    document.getElementById('excelPreviewModal').style.display = 'flex';
}

function updateFlattenedData() {
    flattenedData = [];
    for (let pts of [10, 20, 40]) {
        let sectionName = pts == 10 ? "Dễ" : (pts == 20 ? "Trung Bình" : "Khó");
        for (let item of parsedExcelData[pts]) {
            flattenedData.push({ ...item, pts, sectionName });
        }
    }
}

function renderPreviewTable() {
    const tbody = document.getElementById('previewTbody');
    tbody.innerHTML = '';
    
    let start = (currentPage - 1) * ROWS_PER_PAGE;
    let end = start + ROWS_PER_PAGE;
    let pageData = flattenedData.slice(start, end);
    
    pageData.forEach(item => {
        let errStyle = item.isValid ? "" : "background-color: rgba(231, 76, 60, 0.4);";
        let vidErr = "";
        if (!item.q) vidErr += `<br><small style="color:#ff9f43">Lỗi: Thiếu câu hỏi</small>`;
        
        let rowHtml = `
            <tr style="border-bottom:1px solid #576574; ${errStyle}" data-id="${item.id}" data-pts="${item.pts}">
                <td style="padding:10px; text-align:center;"><input type="checkbox" class="row-chk" value="${item.id}"></td>
                <td style="padding:10px; font-weight:bold;">${item.sectionName}</td>
                <td style="padding:10px;">${item.stt}</td>
                <td style="padding:10px; white-space:pre-wrap;">${escapeHtml(item.q)}</td>
                <td style="padding:10px; white-space:pre-wrap;">${escapeHtml(item.a)}</td>
                <td style="padding:10px; word-break:break-all;">${escapeHtml(item.vid)}${vidErr}</td>
                <td style="padding:10px; text-align:center;">
                    <button class="btn-orange" style="padding:4px 8px; font-size:11px;" onclick="deleteSingleRow('${item.pts}', '${item.id}')">XÓA</button>
                </td>
            </tr>
        `;
        tbody.innerHTML += rowHtml;
    });
    
    renderPagination();
}

function escapeHtml(unsafe) {
    if(!unsafe) return "";
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function renderPagination() {
    const totalPages = Math.ceil(flattenedData.length / ROWS_PER_PAGE);
    let html = `<span>Trang ${currentPage} / ${totalPages || 1} (Tổng: ${flattenedData.length} câu)</span>`;
    
    html += `<button class="btn-secondary" onclick="changePage(-1)" ${currentPage === 1 ? 'disabled' : ''}>Trước</button>`;
    html += `<button class="btn-secondary" onclick="changePage(1)" ${currentPage === totalPages || totalPages === 0 ? 'disabled' : ''}>Sau</button>`;
    
    document.getElementById('paginationControls').innerHTML = html;
}

window.changePage = function(delta) {
    const totalPages = Math.ceil(flattenedData.length / ROWS_PER_PAGE);
    let newPage = currentPage + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        currentPage = newPage;
        renderPreviewTable();
    }
}

window.toggleAllRows = function(chk) {
    const checkboxes = document.querySelectorAll('.row-chk');
    checkboxes.forEach(c => c.checked = chk.checked);
}

window.deleteSingleRow = function(pts, id) {
    parsedExcelData[pts] = parsedExcelData[pts].filter(item => item.id !== id);
    updateFlattenedData();
    const totalPages = Math.ceil(flattenedData.length / ROWS_PER_PAGE);
    if(currentPage > totalPages && totalPages > 0) currentPage = totalPages;
    renderPreviewTable();
}

window.deleteSelectedRows = function() {
    const checkboxes = document.querySelectorAll('.row-chk:checked');
    if (checkboxes.length === 0) return;
    
    const idsToDelete = Array.from(checkboxes).map(c => c.value);
    
    for (let pts of [10, 20, 40]) {
        parsedExcelData[pts] = parsedExcelData[pts].filter(item => !idsToDelete.includes(item.id));
    }
    
    document.getElementById('chkAll').checked = false;
    updateFlattenedData();
    const totalPages = Math.ceil(flattenedData.length / ROWS_PER_PAGE);
    if(currentPage > totalPages && totalPages > 0) currentPage = totalPages;
    renderPreviewTable();
}

window.saveParsedData = function(type) {
    let hasInvalid = flattenedData.some(item => !item.isValid);
    if (hasInvalid) {
        if (!confirm("Cảnh báo: Có các câu hỏi đang bị thiếu thông tin hoặc link video không hợp lệ (màu đỏ). Bạn có chắc chắn muốn lưu không?")) {
            return;
        }
    }
    
    let setIdStr = "";
    let name = "";
    
    if (type === 'draft') {
        setIdStr = 'draft_' + Date.now();
        name = document.getElementById('previewSaveName').value || `Bản Nháp ${new Date().toLocaleString('vi-VN')}`;
    } else {
        setIdStr = document.getElementById('previewSaveSlot').value;
        name = document.getElementById('previewSaveName').value || ((typeof t === 'function' ? t("adm_save_name_prefix", window.currentGlobalLang) : "Đề ") + setIdStr);
    }
    
    let cleanedData = cleanParsedData(parsedExcelData);
    
    fetch(`/api/questions/${setIdStr}`, { headers: { 'x-admin-pin': sessionStorage.getItem('adminAuth') || '' },
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'X-Admin-Pin': sessionStorage.getItem('adminAuth')
        },
        body: JSON.stringify({ name, questions: cleanedData })
    })
    .then(r => r.json())
    .then(d => { 
        alert("Lưu thành công!"); 
        document.getElementById('excelPreviewModal').style.display = 'none';
        
        window.questionBank = cleanedData;
        window.updateQuestionDropdown && window.updateQuestionDropdown();
        window.updateMaxQuestions && window.updateMaxQuestions();
        window.validateQuestionsPerTeam && window.validateQuestionsPerTeam();
        
        loadSlots(); 
    })
    .catch(e => alert("Lỗi khi lưu: " + e.message));
}
