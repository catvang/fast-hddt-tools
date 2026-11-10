(async function initFastHddtPortal() {
    'use strict';

    const CDN_BASE = 'https://cdn.jsdelivr.net/gh/catvang/fast-hddt-tools@main/';

    // 0. Nạp dependencies, CSS và HTML template
    function loadScript(url) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = url;
            s.onload = () => resolve(true);
            s.onerror = () => reject(new Error("Lỗi nạp script: " + url));
            document.head.appendChild(s);
        });
    }

    function loadCss(url) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        document.head.appendChild(link);
    }

    try {
        if (typeof JSZip === 'undefined') {
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
        }
        if (typeof XLSX === 'undefined') {
            await loadScript('https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js');
        }
        loadCss(CDN_BASE + 'hddt-style.css');

        const htmlRes = await fetch(CDN_BASE + 'hddt-template.html');
        if (!htmlRes.ok) throw new Error("Không thể tải HTML Template từ CDN.");
        const htmlContent = await htmlRes.text();

        ['api-hddt-panel', 'api-hddt-modal', 'api-hddt-overlay', 'api-hddt-root-container'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });

        const rootWrap = document.createElement('div');
        rootWrap.id = 'api-hddt-root-container';
        rootWrap.innerHTML = htmlContent;
        document.body.appendChild(rootWrap);

    } catch (e) {
        alert(e.message);
        return;
    }

    // 1. Tiện ích & Hằng số
    function generateUUID() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    function getJwtToken() {
        const match = document.cookie.match(/(?:^|;\s*)jwt=([^;]+)/);
        return match && match[1] ? decodeURIComponent(match[1]) : null;
    }

    const pad = (n) => String(n).padStart(2, '0');
    const fmtDateParam = (d, isEnd) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}T${isEnd ? '23:59:59' : '00:00:00'}`;
    const fmtMoney = (val) => (val !== null && val !== undefined && val !== '') ? Number(val).toLocaleString('vi-VN') : '0';
    const normalizeCode = (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

    const CATEGORIES = [
        { key: 'mv_cm', label: 'Mua vào - Có mã', isPurchase: true, loaiHD: 'co_ma', tag: 'Mua CMa' },
        { key: 'mv_km', label: 'Mua vào - Không mã', isPurchase: true, loaiHD: 'khong_ma', tag: 'Mua KMa' },
        { key: 'mv_mtt', label: 'Mua vào - MTT', isPurchase: true, loaiHD: 'may_tinh_tien', tag: 'Mua MTTien' },
        { key: 'br_cm', label: 'Bán ra - Có mã', isPurchase: false, loaiHD: 'co_ma', tag: 'Ban CMa' },
        { key: 'br_mtt', label: 'Bán ra - MTT', isPurchase: false, loaiHD: 'may_tinh_tien', tag: 'Ban MTTien' }
    ];

    const store = { mv_cm: [], mv_km: [], mv_mtt: [], br_cm: [], br_mtt: [] };
    let currentPeriodInfo = { periodTag: '', year: new Date().getFullYear() };
    let currentActiveTab = 'mv_cm';
    let isFetching = false;
    let isBatchDownloading = false;

    const tabContainer = document.getElementById('modal-tab-container');
    tabContainer.innerHTML = CATEGORIES.map((c, i) => `
        <button class="tab-btn ${i === 0 ? 'active' : ''}" data-key="${c.key}">
            ${c.label} <span class="tab-badge" id="badge-tab-${c.key}">0</span>
        </button>
    `).join('');

    const yearInput = document.getElementById('api-year');
    yearInput.value = new Date().getFullYear();

    // 2. Captcha Dialog
    async function fetchCaptcha() {
        const token = getJwtToken();
        const res = await fetch('https://hoadondientu.gdt.gov.vn/api/captcha', {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Authorization': `Bearer ${token}`,
                'End-Point': '/tra-cuu/tra-cuu-hoa-don',
                'Request-Id': generateUUID()
            }
        });
        if (!res.ok) throw new Error(`Lỗi tải captcha (HTTP ${res.status})`);
        return await res.json();
    }

    function promptCaptcha(svgContent, infoText) {
        return new Promise((resolve) => {
            const oldBox = document.getElementById('sco-captcha-dialog');
            if (oldBox) oldBox.remove();

            const box = document.createElement('div');
            box.id = 'sco-captcha-dialog';
            box.style.cssText = `
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: #ffffff; padding: 18px 24px; border-radius: 12px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.45); z-index: 10000000;
                border: 1px solid #cbd5e1; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                width: 330px; text-align: center;
            `;

            box.innerHTML = `
                <div style="font-weight:700; color:#0f172a; margin-bottom:6px; font-size:14px;">MÃ BẢO MẬT (CAPTCHA)</div>
                <div style="font-size:11.5px; color:#64748b; margin-bottom:10px;">${infoText}</div>
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:6px; margin-bottom:10px; display:flex; justify-content:center;">
                    ${svgContent}
                </div>
                <input type="text" id="sco-captcha-input" maxlength="10" placeholder="Nhập mã captcha..." 
                    style="width: 100%; padding: 8px 12px; border: 1px solid #94a3b8; border-radius: 6px; font-size: 14px; font-weight: bold; text-align: center; box-sizing: border-box; outline: none; margin-bottom: 12px;">
                <div style="display:flex; gap:8px;">
                    <button id="sco-captcha-btn-ok" style="flex:1; background:#0284c7; color:#fff; border:none; padding:8px 0; border-radius:6px; font-weight:700; cursor:pointer;">Xác nhận (Enter)</button>
                    <button id="sco-captcha-btn-cancel" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; padding:8px 12px; border-radius:6px; cursor:pointer;">Bỏ qua</button>
                </div>
            `;
            document.body.appendChild(box);

            const input = document.getElementById('sco-captcha-input');
            input.focus();

            function submit() {
                const val = input.value.trim();
                if (!val) return;
                box.remove();
                resolve(val);
            }

            document.getElementById('sco-captcha-btn-ok').onclick = submit;
            input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
            document.getElementById('sco-captcha-btn-cancel').onclick = () => {
                box.remove();
                resolve(null);
            };
        });
    }

    // 3. TẢI VÀ BÓC TÁCH QUA REST API: /invoices/relative VÀ /invoices/detail
    // 3. TRA CỨU REST API: /invoices/relative VÀ /invoices/detail
    // Chuyển đổi tdlap ISO string thành định dạng dd/mm/yyyy
    function fmtIsoToDateStr(isoStr) {
        if (!isoStr) return '';
        try {
            const d = new Date(isoStr);
            if (isNaN(d.getTime())) return '';
            return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
        } catch (e) {
            return '';
        }
    }

    async function fetchInvoiceRelativeAndDetail(item, isSco) {
        const token = getJwtToken();
        const baseEndpoint = isSco ? 'sco-query' : 'query';
        const cleanShd = parseInt(item.shdon, 10);
        const khhd = (item.khhdon || '').replace(/^[0-9]/, '');
        const khms = item.khmshdon || '1';

        try {
            const relUrl = `https://hoadondientu.gdt.gov.vn/api/${baseEndpoint}/invoices/relative?nbmst=${item.nbmst}&khmshdon=${khms}&khhdon=${encodeURIComponent(khhd)}&shdon=${cleanShd}`;
            
            const relRes = await fetch(relUrl, {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Authorization': `Bearer ${token}`,
                    'End-Point': '/tra-cuu/tra-cuu-hoa-don',
                    'Request-Id': generateUUID()
                }
            });

            if (!relRes.ok) return null;

            const rawJson = await relRes.json();
            if (!rawJson) return null;
            const relData = Array.isArray(rawJson) ? rawJson[0] : rawJson;
            if (!relData) return null;

            // Xử lý linh hoạt 2 chiều:
            let shdMoi = null;
            let khhdMoi = relData.khhdon || null;
            let shdGoc = null;
            let khhdGoc = relData.khhdgoc || null;
            const ngayLapLQuan = fmtIsoToDateStr(relData.tdlap);

            // TH 1: Đứng ở HĐ gốc -> relData.shdgoc = 62422, relData.shdon = 62428
            if (relData.shdgoc && parseInt(relData.shdgoc, 10) === cleanShd) {
                shdGoc = cleanShd;
                shdMoi = parseInt(relData.shdon, 10);
            } 
            // TH 2: Đứng ở HĐ điều chỉnh -> relData.shdgoc = null, relData.shdon = 62422 (HĐ gốc)
            else if (!relData.shdgoc && relData.shdon && parseInt(relData.shdon, 10) !== cleanShd) {
                shdGoc = parseInt(relData.shdon, 10);
                shdMoi = cleanShd;
            }
            // TH 3: Trường hợp còn lại
            else {
                shdMoi = relData.shdon ? parseInt(relData.shdon, 10) : null;
                shdGoc = relData.shdgoc ? parseInt(relData.shdgoc, 10) : null;
            }

            return {
                shdonMoi: shdMoi,
                khhdonMoi: khhdMoi,
                shdgoc: shdGoc,
                khhdgoc: khhdGoc,
                ngayLapLQuan: ngayLapLQuan
            };

        } catch (e) {
            console.warn(`[HDDT] Lỗi API relative cho HĐ ${item.shdon}:`, e);
        }
        return null;
    }

    async function downloadXmlDirectly(item, isSco) {
        const token = getJwtToken();
        const baseEndpoint = isSco ? 'sco-query' : 'query';
        const url = `https://hoadondientu.gdt.gov.vn/api/${baseEndpoint}/invoices/export-xml?nbmst=${item.nbmst}&khhdon=${encodeURIComponent(item.khhdon)}&shdon=${item.shdon}&khmshdon=${item.khmshdon}`;

        const res = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'vi',
                'Authorization': `Bearer ${token}`,
                'End-Point': '/tra-cuu/tra-cuu-hoa-don',
                'Request-Id': generateUUID()
            }
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        let xmlFile = zip.file("invoice.xml") || zip.file(/\.xml$/i)[0];
        const xmlBlob = await xmlFile.async("blob");

        const a = document.createElement('a');
        a.href = URL.createObjectURL(xmlBlob);
        a.download = `${item.nbmst || 'NB'}_${item.nmmst || 'NM'}_${item.khhdon}_${item.shdon}.xml`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    // 4. Tải file Excel máy chủ CQT và tự động lưu về máy
    async function requestServerExcelBuffer(fromD, toD, isPurchase, loaiHD, companyCode, statusEl, monthTag, year) {
        const token = getJwtToken();
        const fromStr = fmtDateParam(fromD, false);
        const toStr = fmtDateParam(toD, true);

        let url = '';
        let actionRaw = '';
        let fileTypeTag = '';
        const isSco = (loaiHD === 'may_tinh_tien');

        if (isSco) {
            fileTypeTag = 'MTTien';
            statusEl.textContent = `[T${monthTag}] Cần mã Captcha tải MTT (${isPurchase ? 'Mua vào' : 'Bán ra'})...`;
            const captchaData = await fetchCaptcha();
            const captchaVal = await promptCaptcha(captchaData.content, `Nhập Captcha cho MTT ${isPurchase ? 'Mua vào' : 'Bán ra'} T${monthTag}/${year}`);
            if (!captchaVal) return null;

            statusEl.textContent = `[T${monthTag}] Đang nạp dữ liệu từ máy chủ CQT...`;
            if (isPurchase) {
                actionRaw = "Xuất hóa đơn có mã khởi tạo từ máy tính tiền mua vào";
                url = `https://hoadondientu.gdt.gov.vn/api/sco-query/invoices/export-excel-sold?sort=tdlap:desc&search=tdlap=ge=${fromStr};tdlap=le=${toStr};ttxly==8&ttxly==8&type=purchase&ckey=${encodeURIComponent(captchaData.key)}&cvalue=${encodeURIComponent(captchaVal)}`;
            } else {
                actionRaw = "Xuất hóa đơn có mã khởi tạo từ máy tính tiền bán ra";
                url = `https://hoadondientu.gdt.gov.vn/api/sco-query/invoices/export-excel?sort=tdlap:desc&search=tdlap=ge=${fromStr};tdlap=le=${toStr}&ckey=${encodeURIComponent(captchaData.key)}&cvalue=${encodeURIComponent(captchaVal)}`;
            }
        } else {
            const ttxly = (loaiHD === 'co_ma') ? 5 : 6;
            if (isPurchase) {
                fileTypeTag = (loaiHD === 'co_ma') ? 'CMa' : 'KMa';
                actionRaw = "Tìm kiếm (hóa đơn mua vào)";
                url = `https://hoadondientu.gdt.gov.vn/api/query/invoices/export-excel-sold?sort=tdlap:desc&search=tdlap=ge=${fromStr};tdlap=le=${toStr};ttxly==${ttxly}&type=purchase`;
            } else {
                fileTypeTag = (loaiHD === 'co_ma') ? 'CMa' : 'KMa';
                actionRaw = "Tìm kiếm (hóa đơn bán ra)";
                url = `https://hoadondientu.gdt.gov.vn/api/query/invoices/export-excel?sort=tdlap:desc&search=tdlap=ge=${fromStr};tdlap=le=${toStr}`;
            }
        }

        const res = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'vi',
                'Authorization': `Bearer ${token}`,
                'Action': encodeURIComponent(actionRaw),
                'End-Point': '/tra-cuu/tra-cuu-hoa-don',
                'Request-Id': generateUUID()
            }
        });

        if (!res.ok) return null;
        const blob = await res.blob();
        const arrayBuffer = await blob.arrayBuffer();

        try {
            const dirStr = isPurchase ? 'Mua' : 'Ban';
            const fileNameParts = [companyCode, 'BK', dirStr, fileTypeTag, `T${monthTag}`, year].filter(Boolean).join(' ');
            const finalFileName = `${fileNameParts}.xlsx`;

            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = finalFileName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            console.log(`[HDDT] Đã tải về file Excel gốc CQT: ${finalFileName}`);
        } catch (e) {
            console.warn("Lỗi lưu file gốc:", e);
        }

        return arrayBuffer;
    }

    // 5. Phân tích Buffer Excel
    function parseExcelBuffer(arrayBuffer, isPurchase, isSco) {
        const wb = XLSX.read(arrayBuffer, { type: 'array' });
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const rawJson = XLSX.utils.sheet_to_json(ws, { header: 1 });

        let headerRowIdx = -1;
        for (let r = 0; r < Math.min(rawJson.length, 12); r++) {
            const row = rawJson[r] || [];
            if (row.some(c => String(c).trim() === 'STT') && row.some(c => String(c).includes('Ký hiệu'))) {
                headerRowIdx = r;
                break;
            }
        }
        if (headerRowIdx === -1) headerRowIdx = 5;

        const headers = (rawJson[headerRowIdx] || []).map(h => String(h || '').trim());
        const getColIdx = (keyword) => headers.findIndex(h => h.toLowerCase().includes(keyword.toLowerCase()));

        const colIdx = {
            khms: getColIdx('mẫu số'),
            kh: getColIdx('ký hiệu hóa đơn'),
            shd: getColIdx('số hóa đơn'),
            ngay: getColIdx('ngày lập'),
            mstBan: getColIdx('mst người bán'),
            tenBan: getColIdx('tên người bán'),
            mstMua: getColIdx('mst người mua'),
            tenMua: getColIdx('tên người mua'),
            chuaThue: getColIdx('chưa thuế'),
            thue: getColIdx('tiền thuế'),
            phi: getColIdx('tiền phí'),
            tong: getColIdx('thanh toán'),
            dvtte: getColIdx('tiền tệ'),
            tt: getColIdx('trạng thái'),
            cqt: getColIdx('kiểm tra')
        };

        const parsedList = [];
        for (let r = headerRowIdx + 1; r < rawJson.length; r++) {
            const row = rawJson[r];
            if (!row || row.length === 0 || !row[colIdx.shd]) continue;

            const sttVal = String(row[0] || '').trim();
            if (sttVal.toUpperCase().includes('TỔNG CỘNG') || sttVal.toUpperCase().includes('TOTAL')) continue;

            let ngayLapStr = String(row[colIdx.ngay] || '').trim();
            let dateIso = '';
            if (ngayLapStr.includes('/')) {
                const parts = ngayLapStr.split('/');
                if (parts.length === 3) dateIso = `${parts[2]}-${pad(parts[1])}-${pad(parts[0])}`;
            }

            const ttText = String(row[colIdx.tt] || 'Hóa đơn mới').trim();
            const ttLower = ttText.toLowerCase();
            let rowType = 'normal';

            if (ttLower.includes('đã bị') || ttLower.includes('bị điều chỉnh') || ttLower.includes('bị thay thế')) {
                rowType = 'replaced_source';
            } else if (ttLower.includes('điều chỉnh') || ttLower.includes('thay thế')) {
                rowType = 'modified';
            }

            parsedList.push({
                khmshdon: String(row[colIdx.khms] || '1').trim(),
                khhdon: String(row[colIdx.kh] || '').trim(),
                shdon: String(row[colIdx.shd] || '').trim(),
                ngayLap: ngayLapStr,
                dateIso: dateIso,
                nbmst: String(row[colIdx.mstBan] || '').trim(),
                nbten: String(row[colIdx.tenBan] || '').trim(),
                nmmst: String(row[colIdx.mstMua] || '').trim(),
                nmten: String(row[colIdx.tenMua] || '').trim(),
                tgtcthue: Number(row[colIdx.chuaThue]) || 0,
                tgtthue: Number(row[colIdx.thue]) || 0,
                tgtphi: (colIdx.phi !== -1 ? Number(row[colIdx.phi]) : 0) || 0,
                tgtttbso: Number(row[colIdx.tong]) || 0,
                dvtte: (colIdx.dvtte !== -1 ? String(row[colIdx.dvtte] || 'VND') : 'VND'),
                statusText: ttText,
                rowType: rowType,
                refText: '-',
                ketQuaXuLy: String(row[colIdx.cqt] || 'Đã kiểm tra').trim(),
                isSco: isSco,
                isPurchase: isPurchase
            });
        }
        return parsedList;
    }

    // 6. Xuất File Excel Tùy Chỉnh Có Cột Hóa Đơn Liên Quan
    function exportTabToExcel(catKey) {
        const cat = CATEGORIES.find(c => c.key === catKey);
        const list = store[catKey] || [];
        if (list.length === 0) return;

        const companyCode = document.getElementById('api-company-code').value.trim() || 'Lkqt';
        const partnerHeaderTitle = cat.isPurchase ? 'Người bán' : 'Người mua';

        const wsData = [
            [`BẢNG KÊ HÓA ĐƠN ĐIỆN TỬ: ${cat.label.toUpperCase()}`],
            [`Kỳ kê khai: ${currentPeriodInfo.periodTag}/${currentPeriodInfo.year} - Đơn vị: ${companyCode}`],
            [],
            [
                'STT', 'Mẫu số', 'Ký hiệu', 'Số hóa đơn', 'Ngày lập',
                `MST ${partnerHeaderTitle}`, `Tên ${partnerHeaderTitle}`,
                'Tiền chưa thuế', 'Tiền thuế', 'Tiền phí', 'Tổng thanh toán',
                'Đơn vị tiền tệ', 'Trạng thái hóa đơn', 'Hóa đơn liên quan (Gốc/Điều chỉnh)', 'Kết quả kiểm tra CQT'
            ]
        ];

        let sumChuaThue = 0, sumThue = 0, sumPhi = 0, sumTong = 0;

        list.forEach((item, idx) => {
            sumChuaThue += Number(item.tgtcthue || 0);
            sumThue += Number(item.tgtthue || 0);
            sumPhi += Number(item.tgtphi || 0);
            sumTong += Number(item.tgtttbso || 0);

            const pMst = cat.isPurchase ? item.nbmst : item.nmmst;
            const pTen = cat.isPurchase ? item.nbten : item.nmten;

            wsData.push([
                idx + 1, item.khmshdon, item.khhdon, item.shdon, item.ngayLap,
                pMst, pTen, item.tgtcthue, item.tgtthue, item.tgtphi, item.tgtttbso,
                item.dvtte, item.statusText, item.refText || '-', item.ketQuaXuLy
            ]);
        });

        wsData.push(['TỔNG CỘNG', '', '', '', '', '', '', sumChuaThue, sumThue, sumPhi, sumTong, '', '', '', '']);

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        const borderThin = {
            top: { style: 'thin', color: { rgb: 'cbd5e1' } },
            bottom: { style: 'thin', color: { rgb: 'cbd5e1' } },
            left: { style: 'thin', color: { rgb: 'cbd5e1' } },
            right: { style: 'thin', color: { rgb: 'cbd5e1' } }
        };

        const headerStyle = {
            font: { bold: true, color: { rgb: 'ffffff' }, sz: 10 },
            fill: { fgColor: { rgb: '0f766e' } },
            alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
            border: borderThin
        };

        for (let C = 0; C < 15; C++) {
            const cellRef = XLSX.utils.encode_cell({ r: 3, c: C });
            if (ws[cellRef]) ws[cellRef].s = headerStyle;
        }

        for (let R = 4; R < 4 + list.length; R++) {
            const item = list[R - 4];
            let rowFill = null;
            if (item.rowType === 'modified') {
                rowFill = { fgColor: { rgb: 'fef08a' } };
            } else if (item.rowType === 'replaced_source') {
                rowFill = { fgColor: { rgb: 'fecaca' } };
            }

            for (let C = 0; C < 15; C++) {
                const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
                if (!ws[cellRef]) continue;

                ws[cellRef].s = {
                    font: { sz: 9.5, color: { rgb: '0f172a' } },
                    border: borderThin,
                    alignment: { vertical: 'center' }
                };
                if (rowFill) ws[cellRef].s.fill = rowFill;
                if ([7, 8, 9, 10].includes(C)) {
                    ws[cellRef].z = '#,##0';
                    ws[cellRef].s.alignment.horizontal = 'right';
                }
                if ([0, 1, 2, 3, 4, 11, 14].includes(C)) {
                    ws[cellRef].s.alignment.horizontal = 'center';
                }
                if (C === 13 && item.refText && item.refText !== '-') {
                    ws[cellRef].s.font = { bold: true, color: { rgb: '0369a1' }, sz: 9.5 };
                }
            }
        }

        const totalRowIdx = 4 + list.length;
        for (let C = 0; C < 15; C++) {
            const cellRef = XLSX.utils.encode_cell({ r: totalRowIdx, c: C });
            if (!ws[cellRef]) continue;
            ws[cellRef].s = {
                font: { bold: true, sz: 10, color: { rgb: '0f172a' } },
                fill: { fgColor: { rgb: 'f1f5f9' } },
                border: borderThin,
                alignment: { vertical: 'center', horizontal: [7, 8, 9, 10].includes(C) ? 'right' : 'center' }
            };
            if ([7, 8, 9, 10].includes(C)) ws[cellRef].z = '#,##0';
        }

        ws['!cols'] = [
            { wch: 6 },  { wch: 8 },  { wch: 11 }, { wch: 10 }, { wch: 12 },
            { wch: 16 }, { wch: 35 }, { wch: 15 }, { wch: 14 }, { wch: 12 },
            { wch: 16 }, { wch: 8 },  { wch: 18 }, { wch: 45 }, { wch: 18 }
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "BangKeHDDT");
        const fileName = `${companyCode}_BK_${cat.tag.replace(/\s+/g, '_')}_${currentPeriodInfo.periodTag}_${currentPeriodInfo.year}.xlsx`;
        XLSX.writeFile(wb, fileName);
    }

    // 7. Workflow Điều phối & Ghi chú liên kết hai chiều theo API chuẩn CQT
    async function startBatchQueryWorkflow(monthsList, periodTag, year) {
        if (isFetching) {
            alert("Đang có tiến trình truy vấn, vui lòng đợi xong!");
            return;
        }

        const token = getJwtToken();
        if (!token) {
            alert("Chưa tìm thấy Cookie 'jwt'! Vui lòng kiểm tra trạng thái đăng nhập.");
            return;
        }

        const selectedKeys = Array.from(document.querySelectorAll('.cb-type-item:checked')).map(cb => cb.value);
        if (selectedKeys.length === 0) {
            alert("Vui lòng chọn ít nhất 1 loại hóa đơn cần tải!");
            return;
        }

        isFetching = true;
        currentPeriodInfo = { periodTag, year };
        const companyCode = (document.getElementById('api-company-code')?.value || 'Lkqt').trim();
        const autoExportCustom = document.getElementById('chk-auto-export-custom-excel')?.checked;
        const statusEl = document.getElementById('api-status');

        selectedKeys.forEach(k => { store[k] = []; });

        try {
            for (let kIdx = 0; kIdx < selectedKeys.length; kIdx++) {
                const catKey = selectedKeys[kIdx];
                const cat = CATEGORIES.find(c => c.key === catKey);
                const isSco = (cat.loaiHD === 'may_tinh_tien');

                statusEl.textContent = `[${kIdx + 1}/${selectedKeys.length}] Đang xử lý: ${cat.label}...`;

                for (let mIdx = 0; mIdx < monthsList.length; mIdx++) {
                    const m = monthsList[mIdx];
                    const daysInMonth = new Date(year, m, 0).getDate();
                    const fromD = new Date(year, m - 1, 1);
                    const toD = new Date(year, m - 1, daysInMonth);

                    statusEl.textContent = `[${cat.label}] Lấy dữ liệu T${pad(m)}/${year}...`;
                    const arrayBuffer = await requestServerExcelBuffer(fromD, toD, cat.isPurchase, cat.loaiHD, companyCode, statusEl, pad(m), year);

                    if (arrayBuffer) {
                        const parsed = parseExcelBuffer(arrayBuffer, cat.isPurchase, isSco);
                        store[catKey] = store[catKey].concat(parsed);
                    }
                    await new Promise(r => setTimeout(r, 400));
                }

                store[catKey].sort((a, b) => (b.dateIso || '').localeCompare(a.dateIso || ''));
               
                // TÌM VÀ LIÊN KẾT HÓA ĐƠN QUA REST API: /invoices/relative
                const needCheckList = store[catKey].filter(inv => inv.rowType === 'modified' || inv.rowType === 'replaced_source');
                
                if (needCheckList.length > 0) {
                    statusEl.textContent = `[${cat.label}] Đang kết nối API Thuế tra cứu HĐ liên quan (${needCheckList.length} HĐ)...`;
                    
                    for (let x = 0; x < needCheckList.length; x++) {
                        const item = needCheckList[x];
                        statusEl.textContent = `[${cat.label}] Tra cứu HĐ ${item.shdon} (${x + 1}/${needCheckList.length})...`;

                        const relInfo = await fetchInvoiceRelativeAndDetail(item, isSco);
                        if (relInfo) {
                            const currentNum = parseInt(item.shdon, 10);
                            const shdMoiNum = relInfo.shdonMoi;
                            const shdGocNum = relInfo.shdgoc;
                            const partnerMst = normalizeCode(cat.isPurchase ? item.nbmst : item.nmmst);
                            const ngayText = relInfo.ngayLapLQuan ? ` ngày ${relInfo.ngayLapLQuan}` : '';

                            // Xác định hành động chuẩn: "điều chỉnh" hay "thay thế" dựa vào trạng thái HĐ
                            const isAdjustment = item.statusText.toLowerCase().includes('điều chỉnh');
                            const actionBi = isAdjustment ? 'Đã bị điều chỉnh' : 'Đã bị thay thế';
                            const actionChuDong = isAdjustment ? 'Điều chỉnh cho HĐ số:' : 'Thay thế cho HĐ số:';

                            // 1. Nếu item hiện tại là HÓA ĐƠN BỊ ĐIỀU CHỈNH HOẶC BỊ THAY THẾ (HĐ gốc)
                            if (currentNum === shdGocNum || item.rowType === 'replaced_source') {
                                if (shdMoiNum) {
                                    const khMoi = relInfo.khhdonMoi ? ` (${relInfo.khhdonMoi})` : '';
                                    item.refText = `${actionBi} bởi HĐ: ${shdMoiNum}${khMoi}${ngayText}`;

                                    // Gán chéo cho HĐ mới nếu cùng nằm trong bảng kê
                                    const newInv = store[catKey].find(cand => {
                                        const cMst = normalizeCode(cat.isPurchase ? cand.nbmst : cand.nmmst);
                                        return (cMst === partnerMst) && (parseInt(cand.shdon, 10) === shdMoiNum);
                                    });
                                    if (newInv) {
                                        newInv.rowType = 'modified';
                                        const khGoc = (item.khmshdon || '') + (item.khhdon || '');
                                        const itemNgay = item.ngayLap ? ` ngày ${item.ngayLap}` : '';
                                        newInv.refText = `${actionChuDong} ${item.shdon} (${khGoc})${itemNgay}`;
                                    }
                                }
                            }
                            // 2. Nếu item hiện tại là HÓA ĐƠN ĐIỀU CHỈNH HOẶC THAY THẾ (HĐ mới)
                            else if (currentNum === shdMoiNum || item.rowType === 'modified') {
                                if (shdGocNum) {
                                    const khGoc = relInfo.khhdgoc ? ` (${relInfo.khhdgoc})` : '';
                                    item.refText = `${actionChuDong} ${shdGocNum}${khGoc}${ngayText}`;

                                    // Gán chéo cho HĐ gốc nếu cùng nằm trong bảng kê
                                    const oldInv = store[catKey].find(cand => {
                                        const cMst = normalizeCode(cat.isPurchase ? cand.nbmst : cand.nmmst);
                                        return (cMst === partnerMst) && (parseInt(cand.shdon, 10) === shdGocNum);
                                    });
                                    if (oldInv) {
                                        oldInv.rowType = 'replaced_source';
                                        const khHienTai = (item.khmshdon || '') + (item.khhdon || '');
                                        const itemNgay = item.ngayLap ? ` ngày ${item.ngayLap}` : '';
                                        oldInv.refText = `${actionBi} bởi HĐ: ${item.shdon} (${khHienTai})${itemNgay}`;
                                    }
                                }
                            }
                        }
                        await new Promise(r => setTimeout(r, 150));
                    }
                }
                
                

                // Cập nhật badge số lượng
                const badge = document.getElementById(`badge-tab-${catKey}`);
                if (badge) badge.textContent = store[catKey].length;

                // Tự động tải Excel tùy chỉnh nếu tùy chọn được bật
                if (autoExportCustom && store[catKey].length > 0) {
                    statusEl.textContent = `[${cat.label}] Đang lưu file Excel tùy chỉnh có HĐ liên quan...`;
                    exportTabToExcel(catKey);
                    await new Promise(r => setTimeout(r, 500));
                }
            }

            statusEl.textContent = `✔ Đã tải và đối chiếu xong toàn bộ!`;
            statusEl.style.color = "#10b981";

            const firstActiveKey = selectedKeys.find(k => store[k].length > 0) || selectedKeys[0];
            switchTab(firstActiveKey);

            document.getElementById('api-hddt-overlay').style.display = 'block';
            document.getElementById('api-hddt-modal').style.display = 'flex';

        } catch (err) {
            statusEl.textContent = "Lỗi: " + err.message;
            statusEl.style.color = "#ef4444";
            console.error(err);
        } finally {
            isFetching = false;
        }
    }

    // 8. Render Table
    function renderTabTable(catKey) {
        currentActiveTab = catKey;
        const cat = CATEGORIES.find(c => c.key === catKey);
        const list = store[catKey] || [];
        const tbody = document.getElementById('modal-tbody');
        tbody.innerHTML = '';

        document.getElementById('modal-title').textContent =
            `Bảng Kê Hóa Đơn Điện Tử: ${cat.label.toUpperCase()} - Kỳ: ${currentPeriodInfo.periodTag}/${currentPeriodInfo.year} (Tổng: ${list.length} HĐ)`;

        list.forEach((item, index) => {
            const tr = document.createElement('tr');
            let partnerName = cat.isPurchase ? (item.nbten || '-') : (item.nmten || '-');
            let partnerMst = cat.isPurchase ? (item.nbmst || '-') : (item.nmmst || '-');

            if (item.rowType === 'modified') tr.className = 'row-warning-modified';
            else if (item.rowType === 'replaced_source') tr.className = 'row-danger-replaced';

            tr.setAttribute('data-mst', String(partnerMst).toLowerCase());
            tr.setAttribute('data-date', item.dateIso);

            tr.innerHTML = `
                <td><input type="checkbox" class="chk-item" data-index="${index}" data-date="${item.dateIso}"></td>
                <td style="text-align: center;">
                    <button class="btn-download-xml" data-index="${index}" title="Tải file XML hóa đơn này">Tải XML</button>
                </td>
                <td style="color: #64748b; text-align: center;">${index + 1}</td>
                <td><strong>${item.khmshdon}${item.khhdon}</strong></td>
                <td><span style="color: #0284c7; font-weight: 600;">${item.shdon}</span></td>
                <td>${item.ngayLap}</td>
                <td style="max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${partnerName}">${partnerName}</td>
                <td class="col-mst">${partnerMst}</td>
                <td style="text-align: center; color: #475569;">${item.dvtte}</td>
                <td style="text-align: right;">${fmtMoney(item.tgtcthue)}</td>
                <td style="text-align: right;">${fmtMoney(item.tgtthue)}</td>
                <td style="text-align: right; color: #64748b;">${fmtMoney(item.tgtphi)}</td>
                <td style="text-align: right; font-weight: 600; color: #0f172a;">${fmtMoney(item.tgtttbso)}</td>
                <td style="text-align: center;"><b>${item.statusText}</b></td>
                <td style="font-size: 11px; max-width: 280px; white-space: normal; color: #0369a1; font-weight: 500;">${item.refText}</td>
                <td style="text-align: center;">${item.ketQuaXuLy}</td>
            `;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.btn-download-xml').forEach(btn => {
            btn.onclick = async function () {
                const idx = parseInt(this.getAttribute('data-index'), 10);
                this.textContent = 'Đang tải...';
                this.disabled = true;
                try {
                    await downloadXmlDirectly(list[idx], cat.loaiHD === 'may_tinh_tien');
                    this.textContent = 'Đã tải';
                } catch (e) {
                    this.textContent = 'Lỗi';
                }
                setTimeout(() => {
                    this.textContent = 'Tải XML';
                    this.disabled = false;
                }, 1500);
            };
        });

        applyMstFilter();
    }

    function switchTab(catKey) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-key') === catKey);
        });
        document.getElementById('filter-mst-input').value = '';
        renderTabTable(catKey);
    }

    function applyMstFilter() {
        const filterVal = (document.getElementById('filter-mst-input').value || '').trim().toLowerCase();
        const rows = document.querySelectorAll('#modal-tbody tr');
        let visibleCount = 0;

        rows.forEach(tr => {
            const rowMst = tr.getAttribute('data-mst') || '';
            if (!filterVal || rowMst.includes(filterVal)) {
                tr.style.display = '';
                visibleCount++;
            } else {
                tr.style.display = 'none';
            }
        });

        const badge = document.getElementById('badge-match-count');
        if (badge) badge.textContent = `${visibleCount}/${rows.length} dòng`;
        updateSummary();
    }

    function updateSummary() {
        const rows = Array.from(document.querySelectorAll('#modal-tbody tr'));
        const total = rows.length;
        const visibleRows = rows.filter(r => r.style.display !== 'none');
        const selectedCount = document.querySelectorAll('#modal-tbody .chk-item:checked').length;
        
        document.getElementById('modal-summary').textContent = 
            `Đã chọn: ${selectedCount} | Hiển thị: ${visibleRows.length}/${total} hóa đơn.`;

        const chkAll = document.getElementById('chk-all');
        if (chkAll && visibleRows.length > 0) {
            chkAll.checked = visibleRows.every(r => {
                const chk = r.querySelector('.chk-item');
                return chk && chk.checked;
            });
        } else if (chkAll) {
            chkAll.checked = false;
        }
    }

    // 9. Gắn sự kiện
    document.getElementById('modal-tab-container').addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-btn');
        if (btn) switchTab(btn.getAttribute('data-key'));
    });

    document.getElementById('btn-export-tab-excel').onclick = () => exportTabToExcel(currentActiveTab);

    document.getElementById('cb-check-all-types').onchange = function () {
        document.querySelectorAll('.cb-type-item').forEach(cb => cb.checked = this.checked);
    };

    document.querySelectorAll('.cb-type-item').forEach(cb => {
        cb.onchange = () => {
            const allCbs = Array.from(document.querySelectorAll('.cb-type-item'));
            document.getElementById('cb-check-all-types').checked = allCbs.every(c => c.checked);
        };
    });

    document.getElementById('filter-mst-input').oninput = applyMstFilter;
    document.getElementById('btn-reset-mst-filter').onclick = () => {
        document.getElementById('filter-mst-input').value = '';
        applyMstFilter();
    };

    document.getElementById('btn-select-visible').onclick = () => {
        const visibleRows = Array.from(document.querySelectorAll('#modal-tbody tr')).filter(r => r.style.display !== 'none');
        visibleRows.forEach(tr => {
            const chk = tr.querySelector('.chk-item');
            if (chk) chk.checked = true;
        });
        updateSummary();
    };

    const overlay = document.getElementById('api-hddt-overlay');
    const modal = document.getElementById('api-hddt-modal');
    document.getElementById('btn-close-modal').onclick = () => {
        overlay.style.display = 'none';
        modal.style.display = 'none';
    };
    overlay.onclick = () => {
        overlay.style.display = 'none';
        modal.style.display = 'none';
    };

    document.getElementById('chk-all').onchange = function () {
        const rows = document.querySelectorAll('#modal-tbody tr');
        rows.forEach(tr => {
            if (tr.style.display !== 'none') {
                const chk = tr.querySelector('.chk-item');
                if (chk) chk.checked = this.checked;
            }
        });
        updateSummary();
    };

    document.getElementById('modal-tbody').addEventListener('change', (e) => {
        if (e.target.classList.contains('chk-item')) updateSummary();
    });

    document.getElementById('btn-apply-date-filter').onclick = () => {
        const filterVal = document.getElementById('filter-date-after').value;
        if (!filterVal) {
            alert("Vui lòng chọn ngày mốc!");
            return;
        }
        const rows = document.querySelectorAll('#modal-tbody tr');
        rows.forEach(tr => {
            if (tr.style.display !== 'none') {
                const itemDate = tr.getAttribute('data-date');
                const chk = tr.querySelector('.chk-item');
                if (chk) chk.checked = Boolean(itemDate && itemDate >= filterVal);
            }
        });
        updateSummary();
    };

    document.getElementById('btn-clear-selection').onclick = () => {
        document.querySelectorAll('.chk-item').forEach(chk => chk.checked = false);
        document.getElementById('chk-all').checked = false;
        updateSummary();
    };

    document.getElementById('btn-download-selected').onclick = async () => {
        if (isBatchDownloading) return;

        const checkedBoxes = Array.from(document.querySelectorAll('.chk-item:checked'));
        if (checkedBoxes.length === 0) {
            alert("Vui lòng tích chọn ít nhất 1 hóa đơn cần tải XML!");
            return;
        }

        isBatchDownloading = true;
        const btnDownload = document.getElementById('btn-download-selected');
        const subStatusEl = document.getElementById('modal-sub-status');
        const originalBtnText = btnDownload.textContent;
        const currentList = store[currentActiveTab];
        const isSco = (currentActiveTab === 'mv_mtt' || currentActiveTab === 'br_mtt');

        btnDownload.disabled = true;

        for (let i = 0; i < checkedBoxes.length; i++) {
            const chk = checkedBoxes[i];
            const idx = parseInt(chk.getAttribute('data-index'), 10);
            const inv = currentList[idx];

            btnDownload.textContent = `Đang tải: ${i + 1}/${checkedBoxes.length}...`;
            subStatusEl.textContent = `Đang tải XML HĐ ${inv.shdon} (${i + 1}/${checkedBoxes.length})`;

            try {
                await downloadXmlDirectly(inv, isSco);
            } catch (e) {
                console.error("Lỗi tải XML:", e);
            }
            await new Promise(r => setTimeout(r, 700));
        }

        btnDownload.textContent = originalBtnText;
        btnDownload.disabled = false;
        subStatusEl.textContent = `✔ Đã tải xong ${checkedBoxes.length} hóa đơn XML.`;
        setTimeout(() => { subStatusEl.textContent = ''; }, 4000);
        isBatchDownloading = false;
    };

    document.getElementById('api-prev-y').onclick = () => yearInput.value = parseInt(yearInput.value, 10) - 1;
    document.getElementById('api-next-y').onclick = () => yearInput.value = parseInt(yearInput.value, 10) + 1;

    document.querySelectorAll('.a-btn-q').forEach(btn => {
        btn.onclick = () => {
            const q = parseInt(btn.getAttribute('data-q'), 10);
            const y = parseInt(yearInput.value, 10);
            const quarterMap = { 1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8, 9], 4: [10, 11, 12] };
            startBatchQueryWorkflow(quarterMap[q], `Q${q}`, y);
        };
    });

    const monthsContainer = document.getElementById('api-months');
    for (let m = 1; m <= 12; m++) {
        const btn = document.createElement('button');
        btn.className = 'a-btn-m';
        btn.textContent = `T${pad(m)}`;
        btn.onclick = () => {
            const y = parseInt(yearInput.value, 10);
            startBatchQueryWorkflow([m], `T${pad(m)}`, y);
        };
        monthsContainer.appendChild(btn);
    }

    console.log("%c[HDDT]%c Đã chuyển sang REST API /relative & /detail thành công!", "color:#0284c7;font-weight:bold;", "color:#16a34a;");
})();
