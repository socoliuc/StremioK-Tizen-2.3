/* Reserve the two selected-file boundary pieces, their .parts copies and its header. */
export function cacheBudget(limit:number,pieceLength:number,piecesCount:number){
 if(!Number.isInteger(pieceLength)||pieceLength<16384||pieceLength>Math.min(4*1024*1024,limit/8)||(pieceLength&(pieceLength-1)))throw new Error('Unsupported torrent piece size')
 const header=Math.ceil((16+piecesCount*8)/1024)*1024
 const usable=Math.floor((limit-4*pieceLength-header-65536)/pieceLength)*pieceLength
 if(usable<2*pieceLength)throw new Error('Torrent metadata exceeds cache budget')
 const clients=Math.min(3,Math.max(1,Math.floor(usable/pieceLength/2)))
 return{usable,clients,window:Math.max(1,Math.min(Math.ceil(2*1024*1024/pieceLength),Math.floor(usable/pieceLength/(clients+1))))}
}
