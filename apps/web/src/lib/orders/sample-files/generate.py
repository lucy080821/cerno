import random, datetime as dt
from openpyxl import Workbook
random.seed(20261115)

PROD = [
 ("AO-001","Áo thun cotton basic",[("Trắng,M",""),("Đen,L",""),("Be,XL","")],149000,129000),
 ("BGN-002","Bình giữ nhiệt inox 500ml",[("Xanh navy",""),("Hồng pastel","")],189000,169000),
 ("TOTE-003","Túi tote canvas",[("Kem","")],129000,99000),
 ("SRM-004","Sữa rửa mặt dịu nhẹ 150ml",[("150ml","")],175000,159000),
 ("KCN-005","Kem chống nắng SPF50 50g",[("50g","")],249000,219000),
 ("CHAO-006","Chảo chống dính 24cm",[("Đen","")],329000,289000),
 ("DEN-007","Đèn bàn LED học tập",[("Trắng ấm",""),("Trắng lạnh","")],279000,249000),
 ("KHAN-008","Khăn tắm sợi tre",[("Xám",""),("Trắng","")],99000,89000),
]
PROV=["TP. Hồ Chí Minh","Hà Nội","Đà Nẵng","Hải Phòng","Cần Thơ","Bình Dương","Đồng Nai","Khánh Hòa","Thừa Thiên Huế","Bà Rịa - Vũng Tàu"]
FAKE_NAMES=["Người mua mẫu 01","Người mua mẫu 02","Người mua mẫu 03","Người mua mẫu 04","Người mua mẫu 05","Người mua mẫu 06"]

def rid(n,alpha="ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"): return "".join(random.choice(alpha) for _ in range(n))

def make_orders(n, start, days):
    out=[]
    for i in range(n):
        d=start+dt.timedelta(days=random.randint(0,days-1),hours=random.randint(7,22),minutes=random.randint(0,59),seconds=random.randint(0,59))
        lines=[]
        for _ in range(random.choice([1,1,1,2,2,3])):
            p=random.choice(PROD); v=random.choice(p[2])[0]
            lines.append((p,v,random.choice([1,1,1,2,3])))
        out.append({"date":d,"lines":lines,"prov":random.choice(PROV),
                    "st":random.choices(["done","shipping","cancel","return","pending"],[62,10,13,8,7])[0],
                    "ship":random.choice([0,12000,15000,18000,22000]),
                    "vshop":random.choice([0,0,0,10000,20000]),"vplat":random.choice([0,0,15000,30000])})
    out.sort(key=lambda o:o["date"])
    return out

# ================= SHOPEE =================
SH_HEAD=["Mã đơn hàng","Ngày đặt hàng","Trạng Thái Đơn Hàng","Lý do hủy","Nhận xét từ Người mua","Mã vận đơn","Đơn Vị Vận Chuyển","Phương thức giao hàng","Loại đơn hàng","Ngày giao hàng dự kiến","Ngày gửi hàng","Thời gian giao hàng thực tế","Trạng Thái Trả hàng/Hoàn tiền","SKU sản phẩm","Tên sản phẩm","Cân nặng sản phẩm","Tổng cân nặng","SKU phân loại hàng","Tên phân loại hàng","Giá gốc","Người bán trợ giá","Được Shopee trợ giá","Tổng số tiền được người bán trợ giá","Giá ưu đãi","Số lượng","Returned quantity","Tổng giá bán (sản phẩm)","Tổng giá trị đơn hàng (VND)","Mã giảm giá của Shop","Hoàn Xu","Mã giảm giá của Shopee","Chỉ tiêu Combo Khuyến Mãi","Giảm giá từ combo Shopee","Giảm giá từ Combo của Shop","Shopee Xu hoàn","Phí vận chuyển (dự kiến)","Phí vận chuyển mà người mua trả","Phí vận chuyển tài trợ bởi Shopee dự kiến","Phí Cố Định","Phí Dịch Vụ","Phí Thanh Toán","Tổng số tiền người mua thanh toán","Thời gian hoàn thành đơn hàng","Thời gian đơn hàng được thanh toán","Phương thức thanh toán","Username (Người mua)","Tên Người nhận","Số điện thoại","Tỉnh/Thành phố","TP / Quận / Huyện","Quận","Địa chỉ nhận hàng","Quốc gia","Ghi chú"]
fmt=lambda d:d.strftime("%Y-%m-%d %H:%M")
wb=Workbook(); ws=wb.active; ws.title="orders"
ws.append(SH_HEAD)
cancel_reasons=["Người mua hủy: Đổi ý, không muốn mua nữa","Người mua hủy: Muốn thay đổi địa chỉ giao hàng","Người bán hủy: Hết hàng"]
carriers=["SPX Express","Giao Hàng Nhanh","J&T Express"]
for o in make_orders(34,dt.datetime(2026,11,1),15):
    oid=o["date"].strftime("%y%m%d")+rid(8)
    sub=sum(round(p[4]*q) for p,v,q in o["lines"])
    pay_total=sub-o["vshop"]-o["vplat"]+o["ship"]
    st={"done":"Hoàn thành","shipping":"Đang giao","cancel":"Đã hủy","return":"Hoàn thành","pending":"Chờ lấy hàng"}[o["st"]]
    valid=o["st"] in ("done","return")
    fixed=round((sub-o["vshop"])*0.06) if valid else 0
    svc=round((sub-o["vshop"])*0.04) if valid else 0
    pm=round((sub-o["vshop"]+o["ship"])*0.0491) if valid else 0
    paym=random.choice(["Ví ShopeePay","Thanh toán khi nhận hàng","Thẻ Tín dụng/Ghi nợ","Chuyển khoản ngân hàng"])
    buyer=random.choice(FAKE_NAMES)
    ship_day=o["date"]+dt.timedelta(days=1); got=o["date"]+dt.timedelta(days=random.randint(3,5))
    for p,v,q in o["lines"]:
        line_sub=round(p[4]*q)
        ws.append([oid,fmt(o["date"]),st,cancel_reasons[random.randint(0,2)] if o["st"]=="cancel" else None,None,
          ("SPXVN"+rid(10,"0123456789")) if o["st"]!="cancel" else None,random.choice(carriers) if o["st"]!="cancel" else None,"Nhanh",
          "Thường",fmt(o["date"]+dt.timedelta(days=4)),fmt(ship_day) if o["st"] not in("cancel","pending") else None,
          fmt(got) if valid else None,"Đã chấp nhận Yêu cầu" if o["st"]=="return" else None,
          p[0],p[1],0.3,0.3*q,p[0]+"-"+rid(2,"ABCDEFGH"),v,p[3],p[3]-p[4],0,round((p[3]-p[4])*q),p[4],q,q if o["st"]=="return" else 0,
          line_sub,sub,o["vshop"],0,o["vplat"],None,0,0,0,o["ship"]+8000,o["ship"],8000,fixed,svc,pm,pay_total,
          fmt(got+dt.timedelta(days=1)) if valid else None,fmt(o["date"]+dt.timedelta(minutes=2)) if o["st"]!="cancel" else None,paym,
          buyer.replace(" ","_").lower(),buyer,"0900000000",o["prov"],o["prov"],"Quận mẫu","Số 1 đường mẫu (địa chỉ giả)","VN",None])
for col,w in zip("ABCDEFGHIJKLMNOPQRSTUVWXYZ",[16,17,16]+[14]*23): ws.column_dimensions[col].width=w
wb.save("MO-PHONG_Shopee_Order.all.20261101_20261115.xlsx")

# ================= TIKTOK SHOP =================
TT_HEAD=["Order ID","Order Status","Order Substatus","Cancelation/Return Type","Normal or Pre-order","SKU ID","Seller SKU","Product Name","Variation","Quantity","Sku Quantity of return","SKU Unit Original Price","SKU Subtotal Before Discount","SKU Platform Discount","SKU Seller Discount","SKU Subtotal After Discount","Shipping Fee After Discount","Original Shipping Fee","Shipping Fee Seller Discount","Shipping Fee Platform Discount","Payment platform discount","Taxes","Order Amount","Order Refund Amount","Created Time","Paid Time","RTS Time","Shipped Time","Delivered Time","Cancelled Time","Cancel By","Cancel Reason","Fulfillment Type","Warehouse Name","Tracking ID","Delivery Option","Shipping Provider Name","Buyer Message","Buyer Username","Recipient","Phone #","Zipcode","Country","Province","District","Detail Address","Payment Method","Weight(kg)","Product Category","Package ID","Seller Note","Checked Status","Checked Marked by"]
TT_DESC=["Platform unique order ID.","Current order status.","Current order sub-status.","Cancellation or return type.","Normal order or pre-order.","Platform unique SKU ID.","SKU ID input by the seller.","Product name.","Variation of the product.","Quantity ordered.","Quantity returned.","Unit original price.","SKU subtotal before discount.","SKU platform discount.","SKU seller discount.","SKU subtotal after discount.","Shipping fee after discount.","Original shipping fee.","Shipping fee seller discount.","Shipping fee platform discount.","Payment platform discount.","Taxes.","Order amount.","Order refund amount.","Order created time.","Order paid time.","Ready-to-ship time.","Shipped time.","Delivered time.","Cancelled time.","Who cancelled the order.","Cancel reason.","Fulfillment type.","Warehouse name.","Tracking ID.","Delivery option.","Shipping provider.","Buyer message.","Buyer username.","Recipient name.","Phone number.","Zipcode.","Country.","Province.","District.","Detail address.","Payment method.","Weight.","Product category.","Package ID.","Seller note.","Checked status.","Checked marked by."]
wb=Workbook(); ws=wb.active; ws.title="OrderSKUList"
ws.append(TT_HEAD); ws.append(TT_DESC)
tfmt=lambda d:d.strftime("%d/%m/%Y %I:%M:%S %p")
for o in make_orders(30,dt.datetime(2026,11,1),15):
    oid="57"+"".join(random.choice("0123456789") for _ in range(16))
    sub_before=sum(p[3]*q for p,v,q in o["lines"])
    plat_disc=o["vplat"]; sel_disc=o["vshop"]
    st,sub={"done":("Completed","Completed"),"shipping":("Shipped","In transit"),"cancel":("Canceled","Canceled by buyer"),"return":("Completed","Completed"),"pending":("Awaiting shipment","Awaiting collection")}[o["st"]]
    paid=o["date"]+dt.timedelta(minutes=1); rts=o["date"]+dt.timedelta(days=1); ship=o["date"]+dt.timedelta(days=1,hours=3); dlv=o["date"]+dt.timedelta(days=random.randint(3,5))
    after_total=sub_before-plat_disc-sel_disc
    amount=after_total+o["ship"]
    for idx,(p,v,q) in enumerate(o["lines"]):
        b=p[3]*q
        share_p=round(plat_disc*b/sub_before); share_s=round(sel_disc*b/sub_before)
        ws.append([oid,st,sub,("Return" if o["st"]=="return" else ("Cancel" if o["st"]=="cancel" else None)),"Normal",
          "17"+"".join(random.choice("0123456789") for _ in range(16)),p[0],p[1],v,q,q if o["st"]=="return" else 0,
          p[3],b,share_p,share_s,b-share_p-share_s,o["ship"],o["ship"]+10000,0,10000,0,0,amount,amount if o["st"]=="return" else 0,
          tfmt(o["date"]),tfmt(paid) if o["st"]!="cancel" else None,tfmt(rts) if o["st"] not in("cancel","pending") else None,
          tfmt(ship) if o["st"] in("done","return","shipping") else None,tfmt(dlv) if o["st"] in("done","return") else None,
          tfmt(o["date"]+dt.timedelta(hours=5)) if o["st"]=="cancel" else None,"Buyer" if o["st"]=="cancel" else None,"Changed my mind" if o["st"]=="cancel" else None,
          "Fulfillment by seller","Kho mẫu","VN"+"".join(random.choice("0123456789") for _ in range(12)),"Standard shipping","J&T Express",None,
          "nguoimua_mau","Người mua mẫu","(+84)900000000","700000","Vietnam",o["prov"],"Quận mẫu","Số 1 đường mẫu (địa chỉ giả)",
          random.choice(["Cash on delivery","Credit card","TikTok Shop wallet"]),0.3*q,"Nhà cửa & Đời sống","PK"+"".join(random.choice("0123456789") for _ in range(10)),None,None,None])
wb.save("MO-PHONG_TikTokShop_OrderSKUList_2026-11.xlsx")
print("ok")
