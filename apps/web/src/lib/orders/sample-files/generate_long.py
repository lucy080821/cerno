#!/usr/bin/env python3
"""
Sinh 2 file đơn hàng MÔ PHỎNG DÀI (~2 năm) cho Shopee và TikTok Shop để thử hiệu năng nhập file.
KHÔNG phải file thật của sàn: tên cột theo `generate.py` (cùng hồ sơ nhận diện), số liệu do mô hình ngẫu nhiên có hạt giống cố định.

    python3 -I generate_long.py <thư mục ra>

Ra 4 file: 2 file .xlsx, 1 file giá vốn (dán vào trang Sản phẩm và giá vốn), 1 file chi phí quảng cáo theo ngày (tải ở trang Chi phí).
"""
import csv, datetime as dt, math, os, random, sys
from openpyxl import Workbook

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
START, END = dt.date(2024, 11, 26), dt.date(2026, 11, 25)
NOW = dt.datetime(2026, 11, 25, 18, 0)
DAYS = (END - START).days + 1
TET = [dt.date(2025, 1, 29), dt.date(2026, 2, 17)]
INFRA_FROM = dt.date(2025, 7, 1)   # Phí Hạ Tầng 3.000đ/đơn
XTRA_FROM = dt.date(2025, 3, 1)    # shop tham gia chương trình phí dịch vụ

# ---------------------------------------------------------------- danh mục sản phẩm
# (sku, tên, nhóm, giá gốc, giá vốn, độ phổ biến, biến thể[(nhãn, hậu tố, trọng số, +giá, +vốn)], tỉ lệ trả hàng, bắt đầu bán, ngừng bán)
def V(*a): return list(a)
SIZES = [("Trắng,M", "TRANG-M", 3, 0, 0), ("Trắng,L", "TRANG-L", 3, 0, 0), ("Đen,M", "DEN-M", 4, 0, 0), ("Đen,L", "DEN-L", 4, 0, 0), ("Be,XL", "BE-XL", 1, 10000, 6000)]
PRODUCTS = [
    ("AO-001", "Áo thun cotton basic", "fashion", 149000, 68000, 10, SIZES, 0.075, None, None),
    ("AO-009", "Áo sơ mi linen tay dài", "fashion", 259000, 118000, 6, [("Kem,M", "KEM-M", 3, 0, 0), ("Kem,L", "KEM-L", 3, 0, 0), ("Xanh,M", "XANH-M", 2, 0, 0), ("Xanh,L", "XANH-L", 2, 0, 0)], 0.085, dt.date(2025, 3, 10), None),
    ("QUAN-010", "Quần jeans ống rộng", "fashion", 329000, 165000, 5, [("Xanh nhạt,28", "XN-28", 2, 0, 0), ("Xanh nhạt,30", "XN-30", 3, 0, 0), ("Xanh đậm,30", "XD-30", 3, 0, 0), ("Xanh đậm,32", "XD-32", 2, 0, 0)], 0.115, None, None),
    ("VAY-011", "Váy hoa nhí dáng dài", "fashion", 289000, 132000, 4, [("Hoa nhí,S", "S", 2, 0, 0), ("Hoa nhí,M", "M", 4, 0, 0), ("Hoa nhí,L", "L", 2, 0, 0)], 0.10, dt.date(2025, 4, 1), None),
    ("DEP-012", "Dép quai ngang đi trong nhà", "home", 79000, 31000, 7, [("Xám,38-39", "XAM-38", 3, 0, 0), ("Xám,40-41", "XAM-40", 3, 0, 0), ("Hồng,38-39", "HONG-38", 2, 0, 0)], 0.04, None, None),
    ("BGN-002", "Bình giữ nhiệt inox 500ml", "home", 189000, 92000, 7, [("Xanh navy", "NAVY", 3, 0, 0), ("Hồng pastel", "HONG", 2, 0, 0), ("Đen nhám", "DEN", 3, 5000, 3000)], 0.03, None, None),
    ("TOTE-003", "Túi tote canvas", "fashion", 129000, 52000, 5, [("Kem", "KEM", 1, 0, 0)], 0.035, None, None),
    ("SRM-004", "Sữa rửa mặt dịu nhẹ 150ml", "beauty", 175000, 78000, 8, [("150ml", "150", 1, 0, 0)], 0.03, None, None),
    ("TONER-014", "Toner diếp cá 200ml", "beauty", 159000, 72000, 5, [("200ml", "200", 1, 0, 0)], 0.035, dt.date(2025, 1, 15), None),
    ("KCN-005", "Kem chống nắng SPF50 50g", "beauty", 249000, 118000, 8, [("50g", "50", 1, 0, 0)], 0.03, None, None),
    ("SON-013", "Son tint lì 4g", "beauty", 119000, 42000, 6, [("Đỏ gạch", "DO", 3, 0, 0), ("Hồng đào", "HD", 3, 0, 0), ("Cam đất", "CAM", 2, 0, 0)], 0.045, None, None),
    ("MASK-015", "Mặt nạ giấy dưỡng ẩm (hộp 10 miếng)", "beauty", 99000, 41000, 5, [("Hộp 10", "H10", 1, 0, 0)], 0.02, None, None),
    ("CHAO-006", "Chảo chống dính 24cm", "home", 329000, 168000, 5, [("Đen", "DEN", 1, 0, 0)], 0.03, None, None),
    ("NCD-016", "Nồi chiên không dầu mini 3L", "home", 590000, 472000, 3, [("Trắng", "TRANG", 1, 0, 0), ("Xám", "XAM", 1, 0, 0)], 0.045, dt.date(2025, 6, 1), None),
    ("AMP-017", "Ấm đun siêu tốc 1.8L", "home", 249000, 156000, 3, [("Inox", "INOX", 1, 0, 0)], 0.04, None, None),
    ("HOP-018", "Bộ hộp cơm thuỷ tinh 3 hộp", "home", 219000, 108000, 4, [("Bộ 3", "B3", 1, 0, 0)], 0.035, None, None),
    ("KHAN-008", "Khăn tắm sợi tre", "home", 99000, 41000, 6, [("Xám", "XAM", 1, 0, 0), ("Trắng", "TRANG", 1, 0, 0)], 0.025, None, None),
    ("GOI-019", "Gối memory foam chống ngáy", "home", 289000, 138000, 3, [("Cao 10cm", "C10", 1, 0, 0), ("Cao 12cm", "C12", 1, 20000, 12000)], 0.05, None, None),
    ("DEN-007", "Đèn bàn LED học tập", "tech", 279000, 139000, 5, [("Trắng ấm", "AM", 1, 0, 0), ("Trắng lạnh", "LANH", 1, 0, 0)], 0.045, None, None),
    ("CAP-020", "Cáp sạc nhanh Type-C 1m", "tech", 39000, 22000, 9, [("1m", "1M", 3, 0, 0), ("2m", "2M", 1, 10000, 6000)], 0.05, None, None),
    ("TAI-021", "Tai nghe Bluetooth TWS", "tech", 349000, 205000, 4, [("Trắng", "TRANG", 1, 0, 0), ("Đen", "DEN", 1, 0, 0)], 0.07, None, dt.date(2026, 6, 30)),
    ("SAC-022", "Sạc dự phòng 10000mAh", "tech", 299000, 214000, 4, [("Đen", "DEN", 1, 0, 0), ("Trắng", "TRANG", 1, 0, 0)], 0.055, None, None),
    ("BUT-023", "Bút gel 0.5mm (hộp 12 cây)", "stationery", 59000, 24000, 5, [("Đen", "DEN", 1, 0, 0), ("Xanh", "XANH", 1, 0, 0)], 0.015, None, None),
    ("SO-024", "Sổ tay A5 kẻ ngang", "stationery", 69000, 28000, 5, [("Be", "BE", 1, 0, 0), ("Xanh rêu", "RIEU", 1, 0, 0)], 0.015, None, None),
    ("BALO-025", "Balo laptop chống nước", "fashion", 359000, 168000, 4, [("Xám", "XAM", 1, 0, 0), ("Đen", "DEN", 2, 0, 0)], 0.05, None, None),
    ("NEN-026", "Nến thơm thư giãn", "home", 129000, 48000, 3, [("Lavender", "LAV", 1, 0, 0), ("Vanilla", "VAN", 1, 0, 0)], 0.025, dt.date(2025, 5, 1), None),
    ("LIXI-027", "Bao lì xì hoạ tiết (set 20)", "stationery", 39000, 14000, 4, [("Set 20", "S20", 1, 0, 0)], 0.01, None, None),
    ("HQ-028", "Hộp quà Tết (trà + bánh)", "home", 249000, 138000, 3, [("Hộp nhỏ", "NHO", 1, 0, 0), ("Hộp lớn", "LON", 1, 90000, 55000)], 0.02, None, None),
]
FIXED_RATE = {"fashion": 0.10, "beauty": 0.105, "home": 0.085, "tech": 0.065, "stationery": 0.09}
PROV = [("TP. Hồ Chí Minh", 24), ("Hà Nội", 16), ("Đà Nẵng", 5), ("Hải Phòng", 3), ("Cần Thơ", 3), ("Bình Dương", 6), ("Đồng Nai", 5), ("Khánh Hòa", 2), ("Thừa Thiên Huế", 2), ("Bà Rịa - Vũng Tàu", 2),
        ("Nghệ An", 2), ("Thanh Hóa", 2), ("Lâm Đồng", 2), ("Long An", 3), ("Quảng Ninh", 1.5), ("Bắc Ninh", 1.5), ("Hải Dương", 1), ("Đắk Lắk", 1.5), ("Tiền Giang", 1.5), ("An Giang", 1.2), ("Quảng Nam", 1.2), ("Bình Định", 1.2)]
PROV_NAMES = [p for p, _ in PROV]
PROV_W = [w for _, w in PROV]

def tet_delta(d):
    return min(((d - t).days for t in TET), key=abs)

def season(p, d):
    """Hệ số theo mùa của từng sản phẩm."""
    sku, cat, m = p[0], p[2], d.month
    td = tet_delta(d)
    if sku in ("LIXI-027", "HQ-028"):
        return 6.0 if -30 <= td <= -3 else 0.0
    if sku == "KCN-005": return {3: 1.4, 4: 1.6, 5: 1.8, 6: 1.8, 7: 1.7, 8: 1.4, 9: 1.0}.get(m, 0.5)
    if sku in ("KHAN-008", "GOI-019", "DEP-012"): return {10: 1.3, 11: 1.5, 12: 1.5, 1: 1.4, 2: 1.2}.get(m, 0.8)
    if sku in ("BALO-025", "BUT-023", "SO-024", "DEN-007"): return {8: 2.6, 9: 3.0, 10: 1.0}.get(m, 0.8)
    if sku == "NEN-026": return 2.5 if (m == 2 and d.day <= 14) or (m == 12) else 0.9
    if cat == "beauty" and ((m == 3 and d.day <= 8) or (m == 10 and 12 <= d.day <= 20)): return 1.6
    if cat == "fashion" and m in (5, 6, 7): return 1.2
    return 1.0

def shop_open_factor(d):
    td = tet_delta(d)
    if -2 <= td <= 5: return 0.04   # shop nghỉ Tết, vài đơn lẻ
    if -16 <= td < -2: return 1.45  # mua sắm trước Tết
    if 5 < td <= 12: return 0.7
    return 1.0

def campaign(d):
    """(hệ số lượng đơn, mức giảm thêm của shop, xác suất flash sale mỗi dòng, nhãn)"""
    if (d.month, d.day) == (11, 11): return 5.0, 0.16, 0.12, "mega"
    if (d.month, d.day) == (12, 12): return 4.0, 0.15, 0.11, "mega"
    if (d.month, d.day) == (9, 9): return 3.4, 0.13, 0.10, "mega"
    if (d.month, d.day) == (10, 10): return 2.6, 0.10, 0.08, "double"
    if d.month == 11 and d.weekday() == 4 and d.day >= 23: return 2.6, 0.12, 0.09, "double"   # Black Friday
    if d.month == d.day: return 1.8, 0.07, 0.06, "double"
    if (d.month, d.day) in ((11, 10), (12, 11), (9, 8)): return 1.3, 0.04, 0.03, "pre"
    if d.day == 25: return 1.25, 0.03, 0.03, "payday"
    return 1.0, 0.0, 0.025, "normal"

HOUR_W = [1.0, 0.5, 0.3, 0.2, 0.2, 0.4, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 6.5, 5.0, 4.5, 4.5, 5.0, 5.5, 6.0, 7.0, 8.5, 9.0, 7.0, 3.0]
HOUR_W_LIVE = [2, 1, 0.5, 0.3, 0.2, 0.2, 0.5, 1, 1.5, 2, 3, 4, 4, 3, 3, 3, 3, 4, 5, 8, 14, 16, 12, 5]

# ---------------------------------------------------------------- mô hình đơn
def pick_products(R, d, live):
    pool = [(p, p[5] * season(p, d)) for p in PRODUCTS
            if (p[8] is None or d >= p[8]) and (p[9] is None or d <= p[9]) and p[5] * season(p, d) > 0]
    n = R.choices([1, 2, 3, 4], [62, 27, 8, 3])[0]
    chosen = []
    for _ in range(n):
        cand = [(p, w) for p, w in pool if p not in chosen]
        if not cand: break
        chosen.append(R.choices([p for p, _ in cand], [w for _, w in cand])[0])
    return chosen

def standing_discount(p, d):
    """Giảm giá thường trực của shop: đổi theo quý, khác nhau theo sản phẩm."""
    h = (sum(ord(c) for c in p[0]) * 31 + d.year * 4 + (d.month - 1) // 3) % 7
    return [0, 0, 0.05, 0.08, 0.10, 0.12, 0.15][h]

def unit_price(R, p, v, d, camp, live):
    base = p[3] + v[3]
    disc = standing_discount(p, d) + camp[1] * R.uniform(0.6, 1.1)
    if R.random() < camp[2] * (2.2 if live else 1):
        disc = R.uniform(0.30, 0.52)  # flash sale / giá live
    elif live:
        disc += R.uniform(0.04, 0.10)
    disc = min(disc, 0.55)
    price = base * (1 - disc)
    step = 500 if base < 100000 else 1000
    return max(step, int(round(price / step)) * step), base

def make_day(R, ch, d, n_orders, live):
    camp = campaign(d)
    wts = HOUR_W_LIVE if live else HOUR_W
    orders = []
    for _ in range(n_orders):
        hour = R.choices(range(24), wts)[0]
        t = dt.datetime(d.year, d.month, d.day, hour, R.randint(0, 59), R.randint(0, 59))
        if t > NOW: t = NOW - dt.timedelta(minutes=R.randint(1, 600))
        lines = []
        for p in pick_products(R, d, live):
            v = R.choices(p[6], [x[2] for x in p[6]])[0]
            cheap = p[3] < 100000
            q = R.choices([1, 2, 3, 5], [76, 16, 5, 3] if cheap else [88, 9, 2, 1])[0]
            up, base = unit_price(R, p, v, d, camp, live)
            lines.append(dict(p=p, v=v, q=q, up=up, base=base))
        sub = sum(l["up"] * l["q"] for l in lines)
        pay_w = [("COD", 55), ("Ví", 18), ("Thẻ", 8), ("CK", 12), ("PayLater", 7)] if ch == "tt" else [("COD", 42), ("Ví", 25), ("Thẻ", 10), ("CK", 14), ("PayLater", 9)]
        pay = R.choices([x for x, _ in pay_w], [w for _, w in pay_w])[0]
        vshop = R.choice([10000, 15000, 20000, 30000]) if R.random() < 0.13 and sub >= 100000 else 0
        vplat = (R.choice([15000, 20000, 30000, 50000]) if R.random() < (0.55 if camp[3] in ("mega", "double") else 0.22) and sub >= 150000 else
                 R.choice([8000, 10000, 15000]) if R.random() < 0.15 else 0)
        est_ship = R.choice([17000, 20000, 24000, 28000, 34000])
        buyer_ship = 0 if sub >= 150000 else min(est_ship, R.choice([12000, 16000, 20000]))
        orders.append(dict(t=t, lines=lines, sub=sub, pay=pay, vshop=vshop, vplat=vplat, est_ship=est_ship, buyer_ship=buyer_ship,
                           prov=R.choices(PROV_NAMES, PROV_W)[0], camp=camp, ch=ch))
    return orders

def decide_status(R, o):
    """Trả về (loại, lý do). Loại: done|ship|pend|cancel|fail|return|reqret"""
    age = (NOW - o["t"]).total_seconds() / 86400
    cod = o["pay"] == "COD"
    tt = o["ch"] == "tt"
    heavy = o["camp"][3] in ("mega", "double")
    mult = 1.35 if heavy else 1.0
    r = R.random()
    p_buyer = (0.065 if cod else 0.032) * (1.25 if tt else 1.0) * mult
    p_seller = 0.006 * (2.5 if o["camp"][3] == "mega" else 1) * (1.5 if tt else 1.0)
    p_unpaid = 0 if cod else 0.010
    p_fail = (0.042 if cod else 0.004) * (1.3 if tt else 1.0)
    if r < p_buyer:
        return "cancel", ("buyer", R.choices(["change", "address", "cheaper", "voucher", "payment"], [38, 18, 22, 12, 10])[0])
    r -= p_buyer
    if r < p_seller: return "cancel", ("seller", "oos")
    r -= p_seller
    if r < p_unpaid: return "cancel", ("system", "unpaid")
    r -= p_unpaid
    if r < p_fail:
        return ("fail", ("system", "fail")) if age >= 4.5 else ("ship", None)
    if age < 0.3: return "pend", None
    if age < 3.5: return "ship", None
    # trả hàng/hoàn tiền: theo nhóm hàng (áo/quần size lệch, hàng điện tử lỗi...)
    rr = 0.7 * max(l["p"][7] for l in o["lines"]) * (1.3 if heavy else 1.0) * (1.25 if tt else 1.0)
    if age >= 5 and R.random() < rr:
        return ("return", R.choices(["size", "defect", "wrong", "notasdesc", "damaged"], [30, 22, 12, 24, 12])[0]) if age >= 14 else ("reqret", None)
    return "done", None

# ---------------------------------------------------------------- Shopee
SH_HEAD = ["Mã đơn hàng", "Ngày đặt hàng", "Trạng Thái Đơn Hàng", "Lý do hủy", "Nhận xét từ Người mua", "Mã vận đơn", "Đơn Vị Vận Chuyển", "Phương thức giao hàng", "Loại đơn hàng", "Ngày giao hàng dự kiến", "Ngày gửi hàng", "Thời gian giao hàng thực tế", "Trạng Thái Trả hàng/Hoàn tiền", "SKU sản phẩm", "Tên sản phẩm", "Cân nặng sản phẩm", "Tổng cân nặng", "SKU phân loại hàng", "Tên phân loại hàng", "Giá gốc", "Người bán trợ giá", "Được Shopee trợ giá", "Tổng số tiền được người bán trợ giá", "Giá ưu đãi", "Số lượng", "Returned quantity", "Tổng giá bán (sản phẩm)", "Tổng giá trị đơn hàng (VND)", "Mã giảm giá của Shop", "Hoàn Xu", "Mã giảm giá của Shopee", "Chỉ tiêu Combo Khuyến Mãi", "Giảm giá từ combo Shopee", "Giảm giá từ Combo của Shop", "Shopee Xu hoàn", "Phí vận chuyển (dự kiến)", "Phí vận chuyển mà người mua trả", "Phí vận chuyển tài trợ bởi Shopee dự kiến", "Phí Cố Định", "Phí Dịch Vụ", "Phí Xử Lý Giao Dịch", "Phí Hạ Tầng", "Tổng số tiền người mua thanh toán", "Thời gian hoàn thành đơn hàng", "Thời gian đơn hàng được thanh toán", "Phương thức thanh toán", "Username (Người mua)", "Tên Người nhận", "Số điện thoại", "Tỉnh/Thành phố", "TP / Quận / Huyện", "Quận", "Địa chỉ nhận hàng", "Quốc gia", "Ghi chú"]
SH_CANCEL = {("buyer", "change"): "Người mua hủy: Đổi ý, không muốn mua nữa", ("buyer", "address"): "Người mua hủy: Muốn thay đổi địa chỉ giao hàng", ("buyer", "cheaper"): "Người mua hủy: Tìm thấy giá rẻ hơn ở nơi khác",
             ("buyer", "voucher"): "Người mua hủy: Cần thay đổi mã giảm giá", ("buyer", "payment"): "Người mua hủy: Thủ tục thanh toán quá rắc rối", ("seller", "oos"): "Người bán hủy: Hết hàng",
             ("system", "unpaid"): "Hệ thống hủy: Quá hạn thanh toán", ("system", "fail"): "Giao hàng không thành công"}
SH_PAY = {"COD": "Thanh toán khi nhận hàng", "Ví": "Ví ShopeePay", "Thẻ": "Thẻ Tín dụng/Ghi nợ", "CK": "Chuyển khoản ngân hàng", "PayLater": "SPayLater"}
SH_CARRIER = ["SPX Express", "Giao Hàng Nhanh", "J&T Express", "Viettel Post"]
fmt = lambda t: t.strftime("%Y-%m-%d %H:%M")

def alnum(R, n, alpha="ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"): return "".join(R.choice(alpha) for _ in range(n))

def shopee_fees(o):
    d = o["t"].date()
    base = o["sub"] - o["vshop"]
    avg_rate = sum(FIXED_RATE[l["p"][2]] * l["up"] * l["q"] for l in o["lines"]) / o["sub"]
    fixed = round(base * avg_rate)
    svc = round(min(base * 0.04, 40000)) if d >= XTRA_FROM else 0
    tx = round((base + o["buyer_ship"]) * (0.06 if d >= INFRA_FROM else 0.05))
    infra = 3000 if d >= INFRA_FROM else 0
    return fixed, svc, tx, infra

def gen_shopee():
    R = random.Random(20261125)
    ws_rows, seen = [], set()
    stats = dict(orders=0, lines=0, cancel=0, fail=0, ret=0, reqret=0)
    for i in range(DAYS):
        d = START + dt.timedelta(days=i)
        camp = campaign(d)
        base = 6.0 + 13.0 * i / DAYS
        dow = [1.0, 0.97, 0.98, 1.0, 1.05, 1.0, 1.08][d.weekday()]
        n = base * dow * shop_open_factor(d) * camp[0] * {1: 1.05, 2: 0.95, 3: 0.95, 4: 0.92, 5: 1.0, 6: 1.05, 7: 1.0, 8: 1.02, 9: 1.1, 10: 1.05, 11: 1.15, 12: 1.15}[d.month]
        n = max(0, int(round(R.gauss(n, n * 0.14))))
        for o in make_day(R, "sh", d, n, False):
            oid = o["t"].strftime("%y%m%d") + alnum(R, 8)
            while oid in seen: oid = o["t"].strftime("%y%m%d") + alnum(R, 8)
            seen.add(oid)
            kind, why = decide_status(R, o)
            stats["orders"] += 1
            stats["lines"] += len(o["lines"])
            valid = kind in ("done", "ship", "pend", "return", "reqret", "fail") and kind != "fail"
            if kind == "cancel": stats["cancel"] += 1
            if kind == "fail": stats["fail"] += 1; stats["cancel"] += 1
            if kind == "return": stats["ret"] += 1
            if kind == "reqret": stats["reqret"] += 1
            age = (NOW - o["t"]).total_seconds() / 86400
            status = {"done": "Hoàn thành" if age >= 9 else "Đã giao", "ship": "Đang giao", "pend": "Chờ lấy hàng", "cancel": "Đã hủy", "fail": "Đã hủy",
                      "return": "Trả hàng/Hoàn tiền", "reqret": "Hoàn thành" if age >= 9 else "Đã giao"}[kind]
            fees = shopee_fees(o) if kind in ("done", "ship", "pend", "return", "reqret") else (0, 0, 0, 0)
            ships = kind in ("done", "ship", "return", "reqret", "fail")
            got = o["t"] + dt.timedelta(days=R.randint(2, 5), hours=R.randint(0, 8))
            delivered = kind in ("done", "return", "reqret")
            tracking = ("SPXVN" + alnum(R, 10, "0123456789")) if ships else None
            total_pay = o["sub"] - o["vshop"] - o["vplat"] + o["buyer_ship"]
            retstat = {"return": "Đã chấp nhận Yêu cầu", "reqret": R.choice(["Đang xử lý", "Đang xử lý", "Người bán đã từ chối", "Người mua đã hủy yêu cầu"])}.get(kind)
            for l in o["lines"]:
                p, v = l["p"], l["v"]
                disc_unit = l["base"] - l["up"]
                ws_rows.append([oid, fmt(o["t"]), status, SH_CANCEL[why] if kind in ("cancel", "fail") else None, None, tracking,
                                R.choice(SH_CARRIER) if ships else None, "Nhanh", "Thường", fmt(o["t"] + dt.timedelta(days=4)),
                                fmt(o["t"] + dt.timedelta(days=1)) if ships else None, fmt(got) if delivered else None, retstat,
                                p[0], p[1], 0.3, round(0.3 * l["q"], 1), f"{p[0]}-{v[1]}", v[0], l["base"], disc_unit, 0, disc_unit * l["q"], l["up"], l["q"],
                                l["q"] if kind == "return" else 0, l["up"] * l["q"], o["sub"], o["vshop"], 0, o["vplat"], None, 0, 0, 0,
                                o["est_ship"], o["buyer_ship"], o["est_ship"] - o["buyer_ship"], fees[0], fees[1], fees[2], fees[3], total_pay,
                                fmt(got + dt.timedelta(days=1)) if delivered else None, fmt(o["t"] + dt.timedelta(minutes=2)) if o["pay"] != "COD" and kind != "cancel" else None,
                                SH_PAY[o["pay"]], "nguoimua_mau", "Người mua mẫu", "0900000000", o["prov"], o["prov"], "Quận mẫu", "Số 1 đường mẫu (địa chỉ giả)", "VN", None])
    return ws_rows, stats

# ---------------------------------------------------------------- TikTok Shop
TT_HEAD = ["Order ID", "Order Status", "Order Substatus", "Cancelation/Return Type", "Normal or Pre-order", "SKU ID", "Seller SKU", "Product Name", "Variation", "Quantity", "Sku Quantity of return", "SKU Unit Original Price", "SKU Subtotal Before Discount", "SKU Platform Discount", "SKU Seller Discount", "SKU Subtotal After Discount", "Shipping Fee After Discount", "Original Shipping Fee", "Shipping Fee Seller Discount", "Shipping Fee Platform Discount", "Payment platform discount", "Taxes", "Order Amount", "Order Refund Amount", "Created Time", "Paid Time", "RTS Time", "Shipped Time", "Delivered Time", "Cancelled Time", "Cancel By", "Cancel Reason", "Fulfillment Type", "Warehouse Name", "Tracking ID", "Delivery Option", "Shipping Provider Name", "Buyer Message", "Buyer Username", "Recipient", "Phone #", "Zipcode", "Country", "Province", "District", "Detail Address", "Payment Method", "Weight(kg)", "Product Category", "Package ID", "Seller Note", "Checked Status", "Checked Marked by"]
TT_DESC = ["Platform unique order ID.", "Current order status.", "Current order sub-status.", "Cancellation or return type.", "Normal order or pre-order.", "Platform unique SKU ID.", "SKU ID input by the seller.", "Product name.", "Variation of the product.", "Quantity ordered.", "Quantity returned.", "Unit original price.", "SKU subtotal before discount.", "SKU platform discount.", "SKU seller discount.", "SKU subtotal after discount.", "Shipping fee after discount.", "Original shipping fee.", "Shipping fee seller discount.", "Shipping fee platform discount.", "Payment platform discount.", "Taxes.", "Order amount.", "Order refund amount.", "Order created time.", "Order paid time.", "Ready-to-ship time.", "Shipped time.", "Delivered time.", "Cancelled time.", "Who cancelled the order.", "Cancel reason.", "Fulfillment type.", "Warehouse name.", "Tracking ID.", "Delivery option.", "Shipping provider.", "Buyer message.", "Buyer username.", "Recipient name.", "Phone number.", "Zipcode.", "Country.", "Province.", "District.", "Detail address.", "Payment method.", "Weight.", "Product category.", "Package ID.", "Seller note.", "Checked status.", "Checked marked by."]
TT_CANCEL = {("buyer", "change"): "Changed my mind", ("buyer", "address"): "Need to change shipping address", ("buyer", "cheaper"): "Found a cheaper price elsewhere", ("buyer", "voucher"): "Want to change voucher",
             ("buyer", "payment"): "Payment problem", ("seller", "oos"): "Out of stock", ("system", "unpaid"): "Payment timeout", ("system", "fail"): "Delivery failed"}
TT_PAY = {"COD": "Cash on delivery", "Ví": "TikTok Shop wallet", "Thẻ": "Credit card", "CK": "Bank transfer", "PayLater": "Pay later"}
tfmt = lambda t: t.strftime("%d/%m/%Y %I:%M:%S %p")

def gen_tiktok():
    R = random.Random(20261126)
    # các ngày livestream/viral: đơn tăng vọt buổi tối, nhiều flash sale dưới giá vốn
    live_days = set()
    cand = [START + dt.timedelta(days=k) for k in range(60, DAYS) if abs(tet_delta(START + dt.timedelta(days=k))) > 16]
    for d in R.sample(cand, 26): live_days.add(d)
    rows, seen = [], set()
    stats = dict(orders=0, lines=0, cancel=0, fail=0, ret=0, reqret=0, live=len(live_days))
    for i in range(DAYS):
        d = START + dt.timedelta(days=i)
        camp = campaign(d)
        live = d in live_days
        base = 1.5 + 11.0 * (i / DAYS) ** 1.25
        dow = [0.95, 0.95, 0.97, 1.0, 1.05, 1.1, 1.12][d.weekday()]
        n = base * dow * shop_open_factor(d) * camp[0] * (R.uniform(3.2, 6.0) if live else 1.0)
        n = max(0, int(round(R.gauss(n, n * 0.2))))
        for o in make_day(R, "tt", d, n, live):
            oid = "57" + "".join(R.choice("0123456789") for _ in range(16))
            while oid in seen: oid = "57" + "".join(R.choice("0123456789") for _ in range(16))
            seen.add(oid)
            kind, why = decide_status(R, o)
            stats["orders"] += 1
            stats["lines"] += len(o["lines"])
            if kind == "cancel": stats["cancel"] += 1
            if kind == "fail": stats["fail"] += 1; stats["cancel"] += 1
            if kind == "return": stats["ret"] += 1
            if kind == "reqret": stats["reqret"] += 1
            age = (NOW - o["t"]).total_seconds() / 86400
            st, sub = {"done": ("Completed", "Completed"), "ship": ("Shipped", "In transit"), "pend": ("Awaiting shipment", "Awaiting collection"),
                       "cancel": ("Canceled", "Canceled by " + (why[0] if kind == "cancel" else "system")),
                       "fail": ("Canceled", "Delivery failed"), "return": ("Returned", "Return/Refund completed"),
                       "reqret": ("Completed", "Completed")}[kind]
            ctype = "Cancel" if kind in ("cancel", "fail") else ("Return/Refund" if kind in ("return", "reqret") else None)
            before = sum(l["base"] * l["q"] for l in o["lines"])
            after = o["sub"]
            seller_total = before - after          # giảm giá của shop (flash sale, giảm thường trực)
            plat_total = o["vplat"]
            amount = after - plat_total + o["buyer_ship"]
            paid = o["t"] + dt.timedelta(minutes=1)
            ships = kind in ("done", "ship", "return", "reqret", "fail")
            dlv = o["t"] + dt.timedelta(days=R.randint(2, 5), hours=R.randint(0, 8))
            tracking = "VN" + "".join(R.choice("0123456789") for _ in range(12)) if ships else None
            for l in o["lines"]:
                p, v = l["p"], l["v"]
                b = l["base"] * l["q"]
                share_s = round(seller_total * b / before)
                share_p = round(plat_total * (l["up"] * l["q"]) / after)
                rows.append([oid, st, sub, ctype, "Normal", "17" + "".join(R.choice("0123456789") for _ in range(16)), p[0], p[1], v[0], l["q"],
                             l["q"] if kind == "return" else 0, l["base"], b, share_p, share_s, b - share_p - share_s, o["buyer_ship"], o["est_ship"],
                             0, o["est_ship"] - o["buyer_ship"], 0, 0, amount, amount if kind == "return" else 0, tfmt(o["t"]),
                             tfmt(paid) if o["pay"] != "COD" and kind != "cancel" else None, tfmt(o["t"] + dt.timedelta(days=1)) if ships else None,
                             tfmt(o["t"] + dt.timedelta(days=1, hours=3)) if ships else None, tfmt(dlv) if kind in ("done", "return", "reqret") else None,
                             tfmt(o["t"] + dt.timedelta(hours=R.randint(2, 20))) if kind in ("cancel", "fail") else None,
                             {"buyer": "Buyer", "seller": "Seller", "system": "System"}[why[0]] if kind in ("cancel", "fail") else None,
                             TT_CANCEL[why] if kind in ("cancel", "fail") else None, "Fulfillment by seller", "Kho mẫu", tracking, "Standard shipping",
                             R.choice(["J&T Express", "Giao Hàng Nhanh", "SPX Express"]), None, "nguoimua_mau", "Người mua mẫu", "(+84)900000000", "700000", "Vietnam",
                             o["prov"], "Quận mẫu", "Số 1 đường mẫu (địa chỉ giả)", TT_PAY[o["pay"]], round(0.3 * l["q"], 1), "Nhà cửa & Đời sống",
                             "PK" + "".join(R.choice("0123456789") for _ in range(10)), None, None, None])
    return rows, stats

# ---------------------------------------------------------------- ghi file
def save(path, title, head, rows, desc=None):
    wb = Workbook(write_only=True)
    ws = wb.create_sheet(title)
    ws.append(head)
    if desc: ws.append(desc)
    for r in rows: ws.append(r)
    wb.save(path)

def ads_rows(sh_rows, tt_rows):
    """Chi phí quảng cáo theo ngày: Shopee Ads ~4-8% doanh thu, TikTok Ads ~8-14%, cao hơn ở ngày sale/live, có ngày tạm dừng."""
    R = random.Random(777)
    rev = {}
    for r in sh_rows: rev.setdefault(("Shopee", r[1][:10]), 0); rev[("Shopee", r[1][:10])] += r[26]
    for r in tt_rows:
        day = dt.datetime.strptime(r[24], "%d/%m/%Y %I:%M:%S %p").strftime("%Y-%m-%d")
        rev.setdefault(("TikTok Shop", day), 0); rev[("TikTok Shop", day)] += r[15]
    out = []
    for (ch, day), v in sorted(rev.items(), key=lambda x: (x[0][1], x[0][0])):
        d = dt.date.fromisoformat(day)
        if R.random() < (0.22 if ch == "Shopee" else 0.18): continue   # ngày tạm dừng quảng cáo
        ratio = R.uniform(0.04, 0.08) if ch == "Shopee" else R.uniform(0.08, 0.14)
        if campaign(d)[3] in ("mega", "double"): ratio *= R.uniform(1.4, 2.2)
        out.append([day, ch, int(round(v * ratio / 1000)) * 1000])
    return [r for r in out if r[2] > 0]

def main():
    os.makedirs(OUT, exist_ok=True)
    sh, s1 = gen_shopee()
    tt, s2 = gen_tiktok()
    save(os.path.join(OUT, "MO-PHONG_Shopee_Order.all.20241126_20261125.xlsx"), "orders", SH_HEAD, sh)
    save(os.path.join(OUT, "MO-PHONG_TikTokShop_OrderSKUList_2024-11_2026-11.xlsx"), "OrderSKUList", TT_HEAD, tt, TT_DESC)
    with open(os.path.join(OUT, "MO-PHONG_GiaVon.txt"), "w", encoding="utf-8") as f:
        f.write("SKU\tGiá vốn\n")
        for p in PRODUCTS: f.write(f"{p[0]}\t{p[4]}\n")
        # giá riêng cho biến thể có vốn khác mã gốc (thắng giá mã gốc)
        for p in PRODUCTS:
            for v in p[6]:
                if v[4]: f.write(f"{p[0]}-{v[1]}\t{p[4] + v[4]}\n")
    with open(os.path.join(OUT, "MO-PHONG_ChiPhiQuangCao_theo_ngay.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f); w.writerow(["Ngày", "Kênh", "Chi phí quảng cáo (VND)"])
        for r in ads_rows(sh, tt): w.writerow(r)
    print("shopee", s1, "dòng", len(sh))
    print("tiktok", s2, "dòng", len(tt))

main()
