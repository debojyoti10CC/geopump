//! Native SOL escrow. The referee attests scoring; it cannot change recipients or deadlines.
#![allow(unexpected_cfgs)]
use solana_program::{account_info::{next_account_info, AccountInfo}, clock::Clock,
    entrypoint::ProgramResult, hash::hashv, program::{invoke, invoke_signed},
    program_error::ProgramError, pubkey::Pubkey, rent::Rent, system_instruction,
    system_program, sysvar::Sysvar};

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

pub const LEN: usize = 372;
pub const JOIN_SECONDS: i64 = 900;
pub const START_SECONDS: i64 = 60;
pub const ROUND_SECONDS: i64 = 30;
pub const SETTLE_SECONDS: i64 = 300;
pub const RETENTION_SECONDS: i64 = 86_400;
const MAGIC: &[u8;8] = b"GEODUEL1";
const MAX_STAKE: u64 = 10_000_000_000;

#[derive(Clone, Debug, PartialEq)]
pub struct Room {
    pub state: u8, pub bump: u8, pub outcome: u8, pub id: [u8;32],
    pub creator: Pubkey, pub joiner: Pubkey, pub referee: Pubkey, pub rent_payer: Pubkey,
    pub stake: u64, pub created_at: i64, pub join_deadline: i64, pub start_deadline: i64,
    pub round_start: i64, pub guess_deadline: i64, pub settle_deadline: i64, pub terminal_at: i64,
    pub commitment: [u8;32], pub transcript: [u8;32], pub lat: i32, pub lng: i32,
    pub asset: [u8;32], pub salt: [u8;32],
}

#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Error { BadInstruction=1, BadAccount=2, BadState=3, Deadline=4, BadStake=5,
    Unauthorized=6, BadCommitment=7, InsufficientEscrow=8, Overflow=9, BadCoordinates=10 }
fn err(e: Error) -> ProgramError { ProgramError::Custom(e as u32) }
fn require(v: bool, e: Error) -> ProgramResult { if v { Ok(()) } else { Err(err(e)) } }
fn arr<const N:usize>(s: &[u8]) -> Result<[u8;N],ProgramError> { s.try_into().map_err(|_|err(Error::BadInstruction)) }
fn u64_at(d:&[u8],o:usize)->u64 { u64::from_le_bytes(d[o..o+8].try_into().unwrap()) }
fn i64_at(d:&[u8],o:usize)->i64 { i64::from_le_bytes(d[o..o+8].try_into().unwrap()) }
fn key_at(d:&[u8],o:usize)->Pubkey { Pubkey::new_from_array(d[o..o+32].try_into().unwrap()) }

impl Room {
    pub fn unpack(d:&[u8]) -> Result<Self,ProgramError> {
        require(d.len()==LEN && &d[..8]==MAGIC && d[8]==1,Error::BadAccount)?;
        Ok(Self { state:d[9],bump:d[10],outcome:d[11],id:arr(&d[12..44])?,creator:key_at(d,44),
            joiner:key_at(d,76),referee:key_at(d,108),rent_payer:key_at(d,140),stake:u64_at(d,172),
            created_at:i64_at(d,180),join_deadline:i64_at(d,188),start_deadline:i64_at(d,196),
            round_start:i64_at(d,204),guess_deadline:i64_at(d,212),settle_deadline:i64_at(d,220),
            terminal_at:i64_at(d,228),commitment:arr(&d[236..268])?,transcript:arr(&d[268..300])?,
            lat:i32::from_le_bytes(d[300..304].try_into().unwrap()),lng:i32::from_le_bytes(d[304..308].try_into().unwrap()),
            asset:arr(&d[308..340])?,salt:arr(&d[340..372])? })
    }
    pub fn pack(&self,d:&mut[u8]) {
        d[..8].copy_from_slice(MAGIC); d[8]=1;d[9]=self.state;d[10]=self.bump;d[11]=self.outcome;
        d[12..44].copy_from_slice(&self.id);
        for (o,k) in [(44,self.creator),(76,self.joiner),(108,self.referee),(140,self.rent_payer)] { d[o..o+32].copy_from_slice(k.as_ref()); }
        d[172..180].copy_from_slice(&self.stake.to_le_bytes());
        for (o,v) in [(180,self.created_at),(188,self.join_deadline),(196,self.start_deadline),
            (204,self.round_start),(212,self.guess_deadline),(220,self.settle_deadline),(228,self.terminal_at)] { d[o..o+8].copy_from_slice(&v.to_le_bytes()); }
        d[236..268].copy_from_slice(&self.commitment); d[268..300].copy_from_slice(&self.transcript);
        d[300..304].copy_from_slice(&self.lat.to_le_bytes()); d[304..308].copy_from_slice(&self.lng.to_le_bytes());
        d[308..340].copy_from_slice(&self.asset); d[340..372].copy_from_slice(&self.salt);
    }
    fn join(&mut self,wallet:Pubkey,now:i64)->ProgramResult {
        require(self.state==0,Error::BadState)?;require(now<self.join_deadline,Error::Deadline)?;
        require(wallet!=self.creator && wallet!=Pubkey::default(),Error::Unauthorized)?;
        self.joiner=wallet;self.state=1;self.start_deadline=now.checked_add(START_SECONDS).ok_or(err(Error::Overflow))?;Ok(())
    }
    fn start(&mut self,commitment:[u8;32],now:i64)->ProgramResult {
        require(self.state==1,Error::BadState)?;require(now<self.start_deadline,Error::Deadline)?;
        require(commitment!=[0;32],Error::BadCommitment)?;
        self.state=2;self.commitment=commitment;self.round_start=now;
        self.guess_deadline=now.checked_add(ROUND_SECONDS).ok_or(err(Error::Overflow))?;
        self.settle_deadline=self.guess_deadline.checked_add(SETTLE_SECONDS).ok_or(err(Error::Overflow))?;Ok(())
    }
    fn expired(&self,now:i64)->ProgramResult {
        let deadline=match self.state {0=>self.join_deadline,1=>self.start_deadline,2=>self.settle_deadline,_=>return Err(err(Error::BadState))};
        require(now>=deadline,Error::Deadline)
    }
    fn payouts(&self,outcome:u8)->Result<(u64,u64),ProgramError> {
        match outcome { 1=>Ok((self.stake.checked_mul(2).ok_or(err(Error::Overflow))?,0)),
            2=>Ok((0,self.stake.checked_mul(2).ok_or(err(Error::Overflow))?)),
            3=>Ok((self.stake,self.stake)),_=>Err(err(Error::BadInstruction)) }
    }
}

pub fn target_hash(program:&Pubkey,room:&Room,lat:i32,lng:i32,asset:&[u8;32],salt:&[u8;32])->[u8;32] {
    hashv(&[b"geo-duels-target-v1",program.as_ref(),&room.id,asset,&lat.to_le_bytes(),&lng.to_le_bytes(),salt]).to_bytes()
}
fn load(program:&Pubkey,a:&AccountInfo)->Result<Room,ProgramError> {
    require(a.owner==program && a.is_writable,Error::BadAccount)?;
    let room=Room::unpack(&a.try_borrow_data()?)?;
    let (pda,bump)=Pubkey::find_program_address(&[b"room",&room.id],program);
    require(pda==*a.key && bump==room.bump,Error::BadAccount)?;Ok(room)
}
fn signer(a:&AccountInfo)->ProgramResult {require(a.is_signer,Error::Unauthorized)}
fn referee(room:&Room,a:&AccountInfo)->ProgramResult {signer(a)?;require(*a.key==room.referee,Error::Unauthorized)}
fn recipients(room:&Room,c:&AccountInfo,j:&AccountInfo)->ProgramResult {
    require(*c.key==room.creator && c.is_writable,Error::BadAccount)?;
    require((room.state==0 || *j.key==room.joiner) && (room.state==0 || j.is_writable),Error::BadAccount)
}
fn pay(room_account:&AccountInfo,recipient:&AccountInfo,amount:u64)->ProgramResult {
    if amount==0 {return Ok(());} require(room_account.key!=recipient.key,Error::BadAccount)?;
    let remaining=room_account.lamports().checked_sub(amount).ok_or(err(Error::InsufficientEscrow))?;
    require(remaining>=Rent::get()?.minimum_balance(LEN),Error::InsufficientEscrow)?;
    let received=recipient.lamports().checked_add(amount).ok_or(err(Error::Overflow))?;
    **room_account.try_borrow_mut_lamports()?=remaining;**recipient.try_borrow_mut_lamports()?=received;Ok(())
}

pub fn process_instruction(program:&Pubkey,accounts:&[AccountInfo],data:&[u8])->ProgramResult {
    let (&tag,body)=data.split_first().ok_or(err(Error::BadInstruction))?;
    let mut a=accounts.iter();let now=Clock::get()?.unix_timestamp;
    if tag==0 {
        require(body.len()==72,Error::BadInstruction)?;
        let creator=next_account_info(&mut a)?;let escrow=next_account_info(&mut a)?;let system=next_account_info(&mut a)?;
        signer(creator)?;require(creator.is_writable && escrow.is_writable && *system.key==system_program::id(),Error::BadAccount)?;
        let id=arr(&body[..32])?;let stake=u64_at(body,32);let ref_key=key_at(body,40);
        require(stake>0 && stake<=MAX_STAKE,Error::BadStake)?;require(ref_key!=Pubkey::default(),Error::Unauthorized)?;
        let (pda,bump)=Pubkey::find_program_address(&[b"room",&id],program);
        require(pda==*escrow.key && escrow.owner==&system_program::id() && escrow.data_is_empty(),Error::BadAccount)?;
        let rent=Rent::get()?.minimum_balance(LEN);let required=rent.checked_add(stake).ok_or(err(Error::Overflow))?;
        let seeds:&[&[u8]]=&[b"room",&id,&[bump]];
        if escrow.lamports()==0 {
            invoke_signed(&system_instruction::create_account(creator.key,escrow.key,required,LEN as u64,program),&[creator.clone(),escrow.clone(),system.clone()],&[seeds])?;
        } else {
            // Pre-funding a PDA must not be able to permanently block a room.
            // A donor may cover rent, but the creator must still deposit exactly one stake.
            let shortfall=stake.checked_add(rent.saturating_sub(escrow.lamports())).ok_or(err(Error::Overflow))?;
            if shortfall>0 {invoke(&system_instruction::transfer(creator.key,escrow.key,shortfall),&[creator.clone(),escrow.clone(),system.clone()])?;}
            invoke_signed(&system_instruction::allocate(escrow.key,LEN as u64),&[escrow.clone(),system.clone()],&[seeds])?;
            invoke_signed(&system_instruction::assign(escrow.key,program),&[escrow.clone(),system.clone()],&[seeds])?;
        }
        let room=Room {state:0,bump,outcome:0,id,creator:*creator.key,joiner:Pubkey::default(),referee:ref_key,rent_payer:*creator.key,stake,
            created_at:now,join_deadline:now.checked_add(JOIN_SECONDS).ok_or(err(Error::Overflow))?,start_deadline:0,round_start:0,guess_deadline:0,settle_deadline:0,
            terminal_at:0,commitment:[0;32],transcript:[0;32],lat:0,lng:0,asset:[0;32],salt:[0;32]};
        room.pack(&mut escrow.try_borrow_mut_data()?);return Ok(());
    }
    let escrow=next_account_info(&mut a)?;let mut room=load(program,escrow)?;
    match tag {
        1=>{ require(body.is_empty(),Error::BadInstruction)?;
            let joiner=next_account_info(&mut a)?;let ref_account=next_account_info(&mut a)?;let system=next_account_info(&mut a)?;
            signer(joiner)?;referee(&room,ref_account)?;require(joiner.is_writable && *system.key==system_program::id(),Error::BadAccount)?;
            room.join(*joiner.key,now)?;
            invoke(&system_instruction::transfer(joiner.key,escrow.key,room.stake),&[joiner.clone(),escrow.clone(),system.clone()])?;
        },
        2=>{ require(body.len()==32,Error::BadInstruction)?;referee(&room,next_account_info(&mut a)?)?;room.start(arr(body)?,now)?; },
        3=>{ require(body.len()==105,Error::BadInstruction)?;referee(&room,next_account_info(&mut a)?)?;
            let creator=next_account_info(&mut a)?;let joiner=next_account_info(&mut a)?;recipients(&room,creator,joiner)?;
            require(room.state==2,Error::BadState)?;require(now>=room.guess_deadline && now<room.settle_deadline,Error::Deadline)?;
            let outcome=body[0];let lat=i32::from_le_bytes(arr(&body[1..5])?);let lng=i32::from_le_bytes(arr(&body[5..9])?);
            require((-90_000_000..=90_000_000).contains(&lat) && (-180_000_000..180_000_000).contains(&lng),Error::BadCoordinates)?;
            let asset=arr(&body[9..41])?;let salt=arr(&body[41..73])?;let transcript=arr(&body[73..105])?;
            require(target_hash(program,&room,lat,lng,&asset,&salt)==room.commitment,Error::BadCommitment)?;
            require(transcript!=[0;32],Error::BadCommitment)?;
            let (cp,jp)=room.payouts(outcome)?;pay(escrow,creator,cp)?;pay(escrow,joiner,jp)?;
            room.state=3;room.outcome=outcome;room.terminal_at=now;room.lat=lat;room.lng=lng;room.asset=asset;room.salt=salt;room.transcript=transcript;
        },
        4=>{require(body.is_empty(),Error::BadInstruction)?;let creator=next_account_info(&mut a)?;signer(creator)?;
            require(*creator.key==room.creator && creator.is_writable,Error::Unauthorized)?;require(room.state==0,Error::BadState)?;
            pay(escrow,creator,room.stake)?;room.state=4;room.outcome=3;room.terminal_at=now;
        },
        5=>{require(body.is_empty(),Error::BadInstruction)?;let creator=next_account_info(&mut a)?;let joiner=next_account_info(&mut a)?;
            recipients(&room,creator,joiner)?;room.expired(now)?;let joined=room.state!=0;
            pay(escrow,creator,room.stake)?;if joined {pay(escrow,joiner,room.stake)?;}
            room.state=4;room.outcome=3;room.terminal_at=now;
        },
        6=>{require(body.is_empty(),Error::BadInstruction)?;let payer=next_account_info(&mut a)?;
            require(*payer.key==room.rent_payer && payer.is_writable && payer.key!=escrow.key,Error::BadAccount)?;
            require(room.state==3 || room.state==4,Error::BadState)?;
            require(now>=room.terminal_at.checked_add(RETENTION_SECONDS).ok_or(err(Error::Overflow))?,Error::Deadline)?;
            let amount=escrow.lamports();let received=payer.lamports().checked_add(amount).ok_or(err(Error::Overflow))?;
            **escrow.try_borrow_mut_lamports()?=0;**payer.try_borrow_mut_lamports()?=received;
            escrow.try_borrow_mut_data()?.fill(0);return Ok(());
        },
        _=>return Err(err(Error::BadInstruction)),
    }
    room.pack(&mut escrow.try_borrow_mut_data()?);Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn room()->Room { Room{state:0,bump:255,outcome:0,id:[7;32],creator:Pubkey::new_unique(),joiner:Pubkey::default(),referee:Pubkey::new_unique(),rent_payer:Pubkey::new_unique(),stake:1_000_001,created_at:100,join_deadline:1000,start_deadline:0,round_start:0,guess_deadline:0,settle_deadline:0,terminal_at:0,commitment:[0;32],transcript:[0;32],lat:0,lng:0,asset:[0;32],salt:[0;32]} }
    #[test] fn account_roundtrip(){let r=room();let mut d=[0u8;LEN];r.pack(&mut d);assert_eq!(Room::unpack(&d).unwrap(),r);d[8]=2;assert!(Room::unpack(&d).is_err());}
    #[test] fn join_distinct_deadline_and_replay(){let mut r=room();assert_eq!(r.join(r.creator,999),Err(err(Error::Unauthorized)));assert_eq!(r.join(Pubkey::new_unique(),1000),Err(err(Error::Deadline)));r.join(Pubkey::new_unique(),999).unwrap();assert_eq!(r.start_deadline,1059);assert_eq!(r.join(Pubkey::new_unique(),999),Err(err(Error::BadState)));}
    #[test] fn start_fixed_windows(){let mut r=room();r.join(Pubkey::new_unique(),110).unwrap();assert_eq!(r.start([1;32],170),Err(err(Error::Deadline)));assert_eq!(r.start([0;32],169),Err(err(Error::BadCommitment)));r.start([1;32],169).unwrap();assert_eq!((r.round_start,r.guess_deadline,r.settle_deadline),(169,199,499));assert!(r.start([2;32],169).is_err());}
    #[test] fn timeout_boundaries(){let mut r=room();assert!(r.expired(999).is_err());r.expired(1000).unwrap();r.join(Pubkey::new_unique(),500).unwrap();assert!(r.expired(559).is_err());r.expired(560).unwrap();r.start([2;32],550).unwrap();assert!(r.expired(879).is_err());r.expired(880).unwrap();r.state=3;assert_eq!(r.expired(9999),Err(err(Error::BadState)));}
    #[test] fn exact_lamport_math(){let r=room();assert_eq!(r.payouts(1).unwrap(),(2_000_002,0));assert_eq!(r.payouts(2).unwrap(),(0,2_000_002));assert_eq!(r.payouts(3).unwrap(),(1_000_001,1_000_001));assert!(r.payouts(4).is_err());}
    #[test] fn commitment_binds_room_program_and_coords(){let r=room();let p=Pubkey::new_unique();let h=target_hash(&p,&r,10,-20,&[5;32],&[6;32]);assert_ne!(h,target_hash(&p,&r,11,-20,&[5;32],&[6;32]));assert_ne!(h,target_hash(&Pubkey::new_unique(),&r,10,-20,&[5;32],&[6;32]));let mut other=r.clone();other.id=[8;32];assert_ne!(h,target_hash(&p,&other,10,-20,&[5;32],&[6;32]));}
    #[test] fn full_processor_authorization_payouts_and_replay() {
        use solana_program::program_stubs::{set_syscall_stubs,SyscallStubs};
        struct TestClock;
        impl SyscallStubs for TestClock {
            fn sol_get_clock_sysvar(&self,p:*mut u8)->u64 { unsafe {std::ptr::write(p as *mut Clock,Clock{unix_timestamp:1000,..Clock::default()})};0 }
            fn sol_get_rent_sysvar(&self,p:*mut u8)->u64 { unsafe {std::ptr::write(p as *mut Rent,Rent::default())};0 }
        }
        let old=set_syscall_stubs(Box::new(TestClock));
        for outcome in [1u8,2,3] {
            let program=Pubkey::new_unique();let sys=system_program::id();let mut r=room();r.joiner=Pubkey::new_unique();r.state=2;r.guess_deadline=1000;r.settle_deadline=1300;
            let (pda,bump)=Pubkey::find_program_address(&[b"room",&r.id],&program);r.bump=bump;
            r.commitment=target_hash(&program,&r,10,-20,&[5;32],&[6;32]);
            let mut data=[0u8;LEN];r.pack(&mut data);let rent=Rent::default().minimum_balance(LEN);
            let mut pot=rent+r.stake*2;let mut c_lamports=99;let mut j_lamports=88;let mut ref_lamports=1;
            let mut c_data=[];let mut j_data=[];let mut ref_data=[];
            let escrow=AccountInfo::new(&pda,false,true,&mut pot,&mut data,&program,false,0);
            let creator=AccountInfo::new(&r.creator,false,true,&mut c_lamports,&mut c_data,&sys,false,0);
            let joiner=AccountInfo::new(&r.joiner,false,true,&mut j_lamports,&mut j_data,&sys,false,0);
            let referee_account=AccountInfo::new(&r.referee,false,false,&mut ref_lamports,&mut ref_data,&sys,false,0);
            let mut accounts=vec![escrow.clone(),referee_account,creator.clone(),joiner.clone()];
            let mut ix=vec![3,outcome];ix.extend(10i32.to_le_bytes());ix.extend((-20i32).to_le_bytes());ix.extend([5u8;32]);ix.extend([6u8;32]);ix.extend([9u8;32]);
            assert_eq!(process_instruction(&program,&accounts,&ix),Err(err(Error::Unauthorized)));
            accounts[1].is_signer=true;
            let mut tampered=ix.clone();tampered[2]^=1;
            assert_eq!(process_instruction(&program,&accounts,&tampered),Err(err(Error::BadCommitment)));
            let mut wrong=accounts.clone();wrong.swap(2,3);
            assert_eq!(process_instruction(&program,&wrong,&ix),Err(err(Error::BadAccount)));
            process_instruction(&program,&accounts,&ix).unwrap();
            let (cp,jp)=r.payouts(outcome).unwrap();
            assert_eq!(creator.lamports(),99+cp);assert_eq!(joiner.lamports(),88+jp);assert_eq!(escrow.lamports(),rent);
            let settled=Room::unpack(&escrow.try_borrow_data().unwrap()).unwrap();assert_eq!((settled.state,settled.outcome,settled.terminal_at),(3,outcome,1000));
            assert_eq!(process_instruction(&program,&accounts,&ix),Err(err(Error::BadState)));
            assert_eq!(creator.lamports(),99+cp);assert_eq!(joiner.lamports(),88+jp);
        }
        set_syscall_stubs(old);
    }
}
