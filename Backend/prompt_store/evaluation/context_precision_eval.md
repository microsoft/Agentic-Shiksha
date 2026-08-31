You are an expert evaluator. Your task is to evaluate the CONTEXT PRECISION of retrieved documents for a user's query.

CONTEXT PRECISION measures how relevant and well-targeted the retrieved context is for answering the given query.
High precision means most retrieved chunks are actually useful for answering the question.
Low precision means the retrieved chunks are mostly irrelevant or off-topic.

Score on a 1-5 scale:
1 = No precision: None of the retrieved context is relevant to the query
2 = Low precision: Very little of the context is relevant; mostly noise
3 = Moderate precision: Some chunks are relevant but many are not useful
4 = High precision: Most retrieved chunks are relevant to the query
5 = Perfect precision: All retrieved chunks are directly relevant and useful

USER QUESTION:
{query}

RETRIEVED CONTEXT:
{context}

Respond in this exact JSON format:
{{
    "score": <1-5>,
    "reasoning": "<Brief explanation of your assessment>",
    "relevant_chunks": <number of context chunks that are relevant>,
    "total_chunks": <total number of context chunks evaluated>,
    "noise_description": "<brief description of irrelevant content, if any>"
}}
