import { Prisma } from '@prisma/client';
import type { ChatMessage as SharedMessage } from '@aw/shared';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
const visibleWhere=(organizationId:string,userId:string)=>({ organizationId, OR:[{ownerId:userId},{visibility:'ORGANIZATION' as const}] });
const conv=(c:any)=>({id:c.id,title:c.title,agentCode:c.agentCode,visibility:c.visibility==='ORGANIZATION'?'organization':'private',ownerId:c.ownerId,createdAt:c.createdAt.toISOString(),updatedAt:c.updatedAt.toISOString()});
const array=(v:Prisma.JsonValue): any[]=>Array.isArray(v)?v:[];
const msg=(m:any):SharedMessage=>({id:m.id,conversationId:m.conversationId,sequence:m.sequence,role:m.role.toLowerCase(),content:m.content,attachments:array(m.attachments) as any,status:m.status==='FAILED'?'failed':'completed',...(m.thinking?{thinking:m.thinking}:{}),generatedFiles:array(m.generatedFiles) as any,...(m.clientRequestId?{clientRequestId:m.clientRequestId}:{}),createdAt:m.createdAt.toISOString()});
async function requireVisible(id:string,organizationId:string,userId:string){const c=await prisma.chatConversation.findFirst({where:{id,...visibleWhere(organizationId,userId)}});if(!c)throw new AppError(404,'?????','NOT_FOUND');return c;}
async function requireOwner(id:string,organizationId:string,userId:string){const c=await prisma.chatConversation.findFirst({where:{id,organizationId,ownerId:userId}});if(!c)throw new AppError(404,'??????????','NOT_FOUND');return c;}
export const conversationService={
 async list(organizationId:string,userId:string){return (await prisma.chatConversation.findMany({where:visibleWhere(organizationId,userId),orderBy:[{updatedAt:'desc'},{id:'desc'}]})).map(conv)},
 async create(input:{organizationId:string;userId:string;agentCode:string;title?:string;visibility?:string}){return conv(await prisma.chatConversation.create({data:{organizationId:input.organizationId,ownerId:input.userId,agentCode:input.agentCode,title:input.title?.trim()||'???',visibility:input.visibility==='organization'?'ORGANIZATION':'PRIVATE'}}))},
 async getMessages(id:string,organizationId:string,userId:string){await requireVisible(id,organizationId,userId);return (await prisma.chatMessage.findMany({where:{conversationId:id},orderBy:{sequence:'asc'}})).map(msg)},
 async update(id:string,organizationId:string,userId:string,input:{title?:string;visibility?:string}){await requireOwner(id,organizationId,userId);return conv(await prisma.chatConversation.update({where:{id},data:{...(input.title!==undefined?{title:input.title.trim()}:{}),...(input.visibility?{visibility:input.visibility==='organization'?'ORGANIZATION':'PRIVATE'}:{})}}))},
 async remove(id:string,organizationId:string,userId:string){await requireOwner(id,organizationId,userId);await prisma.chatConversation.delete({where:{id}})},
 async import(input:{organizationId:string;userId:string;id?:string;title:string;agentCode:string;visibility?:string;messages:Array<any>}){if(input.id){const existing=await prisma.chatConversation.findUnique({where:{id:input.id}});if(existing)throw new AppError(409,'???????','CONVERSATION_EXISTS')}const c=await prisma.chatConversation.create({data:{...(input.id?{id:input.id}:{}),organizationId:input.organizationId,ownerId:input.userId,title:input.title,agentCode:input.agentCode,visibility:input.visibility==='organization'?'ORGANIZATION':'PRIVATE',nextSequence:input.messages.length+1,messages:{create:input.messages.map((m,i)=>({sequence:i+1,role:m.role.toUpperCase(),content:m.content,attachments:m.attachments??[],generatedFiles:m.generatedFiles??[],thinking:m.thinking,status:m.status==='failed'?'FAILED':'COMPLETED',createdAt:m.createdAt?new Date(m.createdAt):undefined}))}}});return conv(c)},
 requireVisible,requireOwner,msg
};
