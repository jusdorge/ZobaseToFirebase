import { db } from "./firebaseConfig";
import { collection, addDoc } from "firebase/firestore";

import React, { useState } from "react";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

function App() {
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [atRowsReceipts, setAtRowsReceipts] = useState([]);
  const [ygRowsReceipts, setYgRowsReceipts] = useState([]);
  const [atRowsReceiptsWithItems, setAtRowsReceiptsWithItems] = useState([]);
  const [ygRowsReceiptsWithItems, setYgRowsReceiptsWithItems] = useState([]);
  const [receiptKey, setReceiptKey] = useState(null);
  const [message, setMessage] = useState("");

  const possibleKeys = [
    "ReceiptID",
    "Receipt Id",
    "Receipt ID",
    "Receipt_Id",
    "receiptid",
    "receipt_id",
    "receipt id",
    "ID",
    "Id",
    "id",
    "InvoiceID",
    "Invoice Id"
  ];

  const findReceiptKey = (obj) => {
    const keys = Object.keys(obj);
    // direct match ignoring case and underscores/spaces
    for (const k of keys) {
      const normalized = k.replace(/[\s_]/g, "").toLowerCase();
      for (const cand of possibleKeys) {
        if (normalized === cand.replace(/[\s_]/g, "").toLowerCase()) {
          return k; // return the actual key name from sheet
        }
      }
    }
    // fallback: try keys that include 'receipt' or 'invoi' or 'id'
    for (const k of keys) {
      const lower = k.toLowerCase();
      if (lower.includes("receipt") || lower.includes("invoi")) return k;
    }
    // last fallback: if single column that looks like id-like
    for (const k of keys) {
      const lower = k.toLowerCase();
      if (lower === "id") return k;
    }
    return null;
  };

    // دالة لاستخراج معلومات المنتج من entryName بصيغة: الاسم_فرنسي  الاسم_عربي (الكمية X السعر)
  const parseEntryName = (entryName) => {
    if (!entryName || typeof entryName !== "string") return null;
    const raw = entryName.trim();
    if (!raw) return null;

    // دعم الفاصلة العشرية والفاصلة كنقطة
    const normalizeNumber = (s) => parseFloat(String(s).replace(",", ".")) || 0;

    // ابحث عن القوس وما بداخله: (الكمية X السعر)
    const insideParenthesesMatch = raw.match(/\((\d+(?:[\.,]\d+)?)\s*[xх×Xx]\s*(\d+(?:[\.,]\d+)?)\)/i);
    
    let quantity = 1;
    let price = 0;
    
    if (insideParenthesesMatch) {
      quantity = normalizeNumber(insideParenthesesMatch[1]);
      price = normalizeNumber(insideParenthesesMatch[2]);
    } else {
      // إذا لم نجد الصيغة الجديدة، نحاول الصيغة القديمة
      const qtyMatch = raw.match(/\((\d+(?:[\.,]\d+)?)\)/);
      const xPriceMatch = raw.match(/[xх×]\s*(\d+(?:[\.,]\d+)?)/i);
      quantity = qtyMatch ? normalizeNumber(qtyMatch[1]) : 1;
      price = xPriceMatch ? normalizeNumber(xPriceMatch[1]) : 0;
    }

    // استخراج اسم المنتج (كل شيء قبل القوس)
    let productName = raw.split("(")[0].trim();
    
    // فصل الاسم الفرنسي والعربي
    // الفرنسي عادة في البداية (أحرف لاتينية)
    // العربي في الوسط (أحرف عربية)
    const frenchMatch = productName.match(/^[a-zA-Z0-9\s\-]+/);
    const arabicMatch = productName.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\s]*/);
    
    const frenchName = frenchMatch ? frenchMatch[0].trim() : "";
    const arabicName = arabicMatch ? arabicMatch[0].trim() : "";
    
    // الاسم الكامل للعرض
    const fullName = [frenchName, arabicName].filter(n => n).join(" ");

    if (!productName) productName = raw;

    return {
      productName: fullName || productName,
      frenchName,
      arabicName,
      quantity,
      price,
      totalPrice: quantity * price
    };
  };
  // دالة للعثور على مفتاح entryName
  const findEntryNameKey = (obj) => {
    const keys = Object.keys(obj);
    for (const k of keys) {
      const normalized = k.replace(/[\s_]/g, "").toLowerCase();
      if (normalized === "entryname" || normalized === "entry_name" || normalized === "entry") {
        return k;
      }
    }
    return null;
  };

  // دالة لتوحيد اسم المنتج بشكل قوي جداً لأغراض التجميع
  const normalizeProductName = (name) => {
    if (!name) return "";
    // إزالة علامات التشكيل، الحروف اللاتينية الزائدة، نقاط، محارف غير عربية/أرقام/مسافة، توحيد الفاصل
    return name
      .replace(/[\u064B-\u065F\u0610-\u061A\u06D6-\u06ED]/g, "") // ازالة التشكيل
      .replace(/[\-‐‑‒–—―ـ]/g, "") // حذف مدات وسطية والشرطات
      .replace(/[\u200C-\u200F]/g, " ") // محارف دولية خفية
      .replace(/[^\p{L}\p{N} ]/gu, "") // حذف سوى الأحرف والأرقام ومسافة
      .replace(/\s+/g, " ") // توحيد الفراغ
      .trim()
      .toLowerCase();
  };

  // دالة لتجميع وتحليل المنتجات من receiptswithitems
  const analyzeProducts = (rows) => {
    if (!rows || rows.length === 0) return [];
    // العثور على مفتاح entryName من أول صف
    const entryNameKey = findEntryNameKey(rows[0]);
    if (!entryNameKey) return [];

    const productsMap = new Map();
    for (const row of rows) {
      const entryName = row[entryNameKey];
      if (!entryName) continue;
      const parsed = parseEntryName(String(entryName));
      if (!parsed) continue;
      const key = normalizeProductName(parsed.productName);
      if (productsMap.has(key)) {
        const existing = productsMap.get(key);
        existing.quantity += parsed.quantity;
        existing.totalPrice += parsed.totalPrice;
        existing.count += 1;
        // تحديث السعر حسب المتوسط
        existing.price = existing.totalPrice / existing.quantity;
      } else {
        productsMap.set(key, {
          productName: parsed.productName,
          quantity: parsed.quantity,
          price: parsed.price,
          totalPrice: parsed.totalPrice,
          count: 1
        });
      }
    }
    // تحويل Map إلى مصفوفة مرتبة
    return Array.from(productsMap.values())
      .sort((a, b) => {
        const nameA = (a.frenchName || a.arabicName || a.productName || "").toLowerCase();
        const nameB = (b.frenchName || b.arabicName || b.productName || "").toLowerCase();
        return nameA.localeCompare(nameB);
      })
      .map(item => ({
        "اسم المنتج": item.productName,
        "عدد الوحدات": item.quantity,
        "عدد المرات": item.count
      }));
  };

  const handleFileUpload = async (e) => {
    resetState();
    const f = e.target.files[0];
    if (!f) return;
    setFileName(f.name);

    try {
      const data = await f.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      
      const targetSheets = ["receipts", "receiptswithitems"];
      const sheetsData = {};
      
      // البحث عن الصفحات المطلوبة (case-insensitive)
      for (const sheetName of workbook.SheetNames) {
        const normalizedName = sheetName.toLowerCase().trim();
        if (targetSheets.includes(normalizedName)) {
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
          if (jsonData && jsonData.length > 0) {
            sheetsData[normalizedName] = jsonData;
          }
        }
      }

      if (Object.keys(sheetsData).length === 0) {
        setMessage("لم يتم العثور على الصفحات 'receipts' أو 'receiptswithitems' في الملف.");
        return;
      }

      // استخدام أول صفحة للعثور على مفتاح Receipt
      const firstSheetName = targetSheets.find(s => sheetsData[s]) || Object.keys(sheetsData)[0];
      const firstSheetData = sheetsData[firstSheetName];
      if (!firstSheetData || firstSheetData.length === 0) {
        setMessage("الملف لا يحتوي على بيانات.");
        return;
      }

      const foundKey = findReceiptKey(firstSheetData[0]);
      setReceiptKey(foundKey);
      setHeaders(Object.keys(firstSheetData[0]).slice(0, 30));
      setPreviewRows(firstSheetData.slice(0, 10));

      if (!foundKey) {
        setMessage(
          "لم أعثر على عمود ReceiptID تلقائياً. من فضلك تأكد من اسم العمود أو أعد تسمية العمود ليحتوي على 'Receipt' أو 'ID'. عرض معاينة أعلى."
        );
        return;
      }

      // تصفية الصفوف لكل صفحة
      const atReceipts = [];
      const ygReceipts = [];
      const atReceiptsWithItems = [];
      const ygReceiptsWithItems = [];

      if (sheetsData["receipts"]) {
        for (const row of sheetsData["receipts"]) {
          const val = row[foundKey];
          if (val === undefined || val === null) continue;
          const s = String(val).trim();
          if (s.toUpperCase().startsWith("AT")) atReceipts.push(row);
          else if (s.toUpperCase().startsWith("YG")) ygReceipts.push(row);
        }
      }

      if (sheetsData["receiptswithitems"]) {
        for (const row of sheetsData["receiptswithitems"]) {
          const val = row[foundKey];
          if (val === undefined || val === null) continue;
          const s = String(val).trim();
          if (s.toUpperCase().startsWith("AT")) atReceiptsWithItems.push(row);
          else if (s.toUpperCase().startsWith("YG")) ygReceiptsWithItems.push(row);
        }
      }

      setAtRowsReceipts(atReceipts);
      setYgRowsReceipts(ygReceipts);
      setAtRowsReceiptsWithItems(atReceiptsWithItems);
      setYgRowsReceiptsWithItems(ygReceiptsWithItems);

      const totalAt = atReceipts.length + atReceiptsWithItems.length;
      const totalYg = ygReceipts.length + ygReceiptsWithItems.length;

      if (totalAt === 0 && totalYg === 0) {
        setMessage(
          `تم العثور على العمود '${foundKey}' لكن لم تُوجد صفوف تبدأ بـ "AT" أو "YG".\n` +
            `تفقد القيم — قد تحتوي على مسافات زائدة أو بادئات مختلفة. (عرض أول 10 صفوف للمعاينة)`
        );
      } else {
        setMessage(
          `اكتمل الفحص.\n` +
          `receipts - AT: ${atReceipts.length} صفوف، YG: ${ygReceipts.length} صفوف\n` +
          `receiptswithitems - AT: ${atReceiptsWithItems.length} صفوف، YG: ${ygReceiptsWithItems.length} صفوف\n` +
          `يمكنك تنزيل الملفات أدناه.`
        );
      }
    } catch (err) {
      console.error(err);
      setMessage("حدث خطأ أثناء قراءة الملف: " + err.message);
    }
  }

  const resetState = () => {
    setFileName("");
    setHeaders([]);
    setPreviewRows([]);
    setAtRowsReceipts([]);
    setYgRowsReceipts([]);
    setAtRowsReceiptsWithItems([]);
    setYgRowsReceiptsWithItems([]);
    setReceiptKey(null);
    setMessage("");
  };

  const createAndSaveFile = (data, name) => {
    const wb = XLSX.utils.book_new();
    if (!Array.isArray(data) || data.length === 0) {
      setMessage("لا توجد صفوف للتنزيل.");
      return;
    }

    const firstItem = data[0];
    const isMultiSheet = firstItem && typeof firstItem === "object" && Object.prototype.hasOwnProperty.call(firstItem, "rows");

    if (isMultiSheet) {
      data.forEach(({ sheetName, rows }, idx) => {
        const ws = XLSX.utils.json_to_sheet(rows || []);
        XLSX.utils.book_append_sheet(wb, ws, sheetName || `Sheet${idx + 1}`);
      });
    } else {
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    }

    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([wbout], { type: "application/octet-stream" }), name);
  };

  const hasData = (atRowsReceipts.length > 0 || ygRowsReceipts.length > 0 || 
                   atRowsReceiptsWithItems.length > 0 || ygRowsReceiptsWithItems.length > 0);

  return (
    <div style={{ fontFamily: "Arial, sans-serif", padding: 24 }}>
      <h2>Excel Splitter — تقسيم حسب ReceiptID (AT / YG)</h2>

      <div style={{ marginBottom: 12 }}>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileUpload}
          style={{ padding: 8 }}
        />
      </div>

      {fileName && <div><strong>الملف:</strong> {fileName}</div>}

      <div style={{ marginTop: 12, whiteSpace: "pre-line" }}>
        {message && <div style={{ margin: "8px 0", color: "#0b5394" }}>{message}</div>}
      </div>

      {receiptKey && (
        <div style={{ marginTop: 12 }}>
          <strong>اكتشف العمود:</strong> {receiptKey}
        </div>
      )}

      {previewRows.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4>معاينة أول 10 صفوف</h4>
          <div style={{ overflowX: "auto", border: "1px solid #ddd", padding: 8 }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  {Object.keys(previewRows[0]).map((h) => (
                    <th
                      key={h}
                      style={{
                        border: "1px solid #ccc",
                        padding: "6px 8px",
                        background: h === receiptKey ? "#f8f9fb" : "#fff"
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((r, i) => (
                  <tr key={i}>
                    {Object.keys(r).map((k) => (
                      <td key={k} style={{ border: "1px solid #eee", padding: "6px 8px" }}>
                        {String(r[k])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasData && (
        <div style={{ marginTop: 18 }}>
          <div style={{ marginBottom: 8 }}>
            <strong>النتائج:</strong>
            <div>receipts - AT: {atRowsReceipts.length} صفوف، YG: {ygRowsReceipts.length} صفوف</div>
            <div>receiptswithitems - AT: {atRowsReceiptsWithItems.length} صفوف، YG: {ygRowsReceiptsWithItems.length} صفوف</div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
       
            {(atRowsReceipts.length > 0 || atRowsReceiptsWithItems.length > 0) && (
              <button
                onClick={() => {
                  const sheets = [];
                  if (atRowsReceipts.length > 0) {
                    sheets.push({ sheetName: "الفواتير", rows: atRowsReceipts });
                  }
                  if (atRowsReceiptsWithItems.length > 0) {
                    sheets.push({ sheetName: "الفواتير بالمنتجات", rows: atRowsReceiptsWithItems });
                    // إضافة صفحة التحليل
                    const analyzedProducts = analyzeProducts(atRowsReceiptsWithItems);
                    if (analyzedProducts.length > 0) {
                      sheets.push({ sheetName: "تحليل المنتجات", rows: analyzedProducts });
                    }
                  }
                  if (sheets.length === 0) {
                    setMessage("لا توجد صفوف AT للتنزيل.");
                    return;
                  }
                  const baseFileName = fileName.replace(/\.[^/.]+$/, "");
                  createAndSaveFile(sheets, `${baseFileName}_AT.xlsx`);
                }}
                style={{ padding: "8px 12px", cursor: "pointer" }}
              >
                تنزيل ملف AT
              </button>
            )}
            {(ygRowsReceipts.length > 0 || ygRowsReceiptsWithItems.length > 0) && (
              <button
                onClick={() => {
                  const sheets = [];
                  if (ygRowsReceipts.length > 0) {
                    sheets.push({ sheetName: "الفواتير", rows: ygRowsReceipts });
                  }
                  if (ygRowsReceiptsWithItems.length > 0) {
                    sheets.push({ sheetName: "الفواتير بالمنتجات", rows: ygRowsReceiptsWithItems });
                    // إضافة صفحة التحليل
                    const analyzedProducts = analyzeProducts(ygRowsReceiptsWithItems);
                    if (analyzedProducts.length > 0) {
                      sheets.push({ sheetName: "تحليل المنتجات", rows: analyzedProducts });
                    }
                  }
                  if (sheets.length === 0) {
                    setMessage("لا توجد صفوف YG للتنزيل.");
                    return;
                  }
                  const baseFileName = fileName.replace(/\.[^/.]+$/, "");
                  createAndSaveFile(sheets, `${baseFileName}_YG.xlsx`);
                }}
                style={{ padding: "8px 12px", cursor: "pointer" }}
              >
                تنزيل ملف YG
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
