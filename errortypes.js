export class DuplicateMemberError extends Error {
    constructor(message) {
        super(message);
        this.name = "DuplicateMemberError";
    }
}

export class DuplicateLeaveError extends Error {
    constructor(message) {
        super(message);
        this.name = "DuplicateLeaveError";
    }
}

export class MemberNotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = "MemberNotFoundError";
    }
}
