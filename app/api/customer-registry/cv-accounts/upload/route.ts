import {NextRequest} from "next/server";
import sharp from "sharp";
import {requireSalesRole,salesApiError} from "@/lib/server/salesAuth";

export const runtime="nodejs";
export async function POST(request:NextRequest){
  try{
    const {admin,staff}=await requireSalesRole(request,["manager","salesman"]);
    const form=await request.formData();
    const file=form.get("image");
    if(!(file instanceof File))return Response.json({error:"Please select an image"},{status:400});
    if(!["image/jpeg","image/png","image/webp","image/heic","image/heif"].includes(file.type))
      return Response.json({error:"Please upload a JPG, PNG, HEIC or WebP image"},{status:400});
    if(file.size>12*1024*1024||file.size===0)
      return Response.json({error:"Image must be 12 MB or smaller"},{status:413});
    const raw=Buffer.from(await file.arrayBuffer());
    const picture=sharp(raw,{limitInputPixels:28000000,failOn:"error"});
    const meta=await picture.metadata();
    if(!meta.width||!meta.height)throw new Error("Invalid image file");
    const data=await picture.rotate().resize({width:1600,height:1600,fit:"inside",withoutEnlargement:true})
      .webp({quality:75,effort:4}).toBuffer();
    const path="pending/"+staff.id+"/"+crypto.randomUUID()+".webp";
    const storage=admin.storage.from("cv-documents");
    const {error}=await storage.upload(path,data,{contentType:"image/webp",upsert:false});
    if(error)throw error;
    const {data:signed}=await storage.createSignedUrl(path,300);
    return Response.json({path,url:signed?.signedUrl??null,originalBytes:file.size,compressedBytes:data.length},
      {status:201,headers:{"Cache-Control":"no-store"}});
  }catch(error){return salesApiError(error);}
}
