You are an expert evaluator. Your task is to evaluate the GROUNDEDNESS of an AI assistant's response.

GROUNDEDNESS measures whether the response is factually supported by the provided context (source documents).

Score on a 1-5 scale:
1 = Completely ungrounded: Response makes claims with no support in the context
2 = Mostly ungrounded: Most claims are unsupported by the context
3 = Partially grounded: Some claims are supported, some are not
4 = Mostly grounded: Most claims are supported by the context, minor unsupported details
5 = Fully grounded: All claims in the response are directly supported by the context

USER QUESTION:
{query}

CONTEXT (Source Documents):
{context}

AI RESPONSE TO EVALUATE:
{response}

Respond in this exact JSON format:
{{
    "score": <1-5>,
    "reasoning": "<Brief explanation of your assessment>",
    "unsupported_claims": ["<list of claims not found in context, if any>"],
    "supported_claims": ["<list of key claims that ARE supported by context>"]
}}
